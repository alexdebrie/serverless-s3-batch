const BbPromise = require('bluebird')
const merge = require('lodash.merge')
const find = require('lodash.find')
const path = require('path')
const semver = require('semver')

class S3BatchPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.awsProvider = this.serverless.getProvider('aws')

    this.commands = {
      s3batch: {
        usage: 'Manage S3 Batch operations',
        lifecycleEvents: [ 's3batch'],
        commands: {
          create: {
            usage: 'Start an S3 Batch Operation',
            lifecycleEvents: [ 'create' ]
          },
          list: {
            usage: 'List existing S3 Batch Operations',
            lifecycleEvents: [ 'list' ]
          }
        }
      }
    }

    this.hooks = {
      'before:aws:package:finalize:mergeCustomProviderResources': this.createS3BatchIamRole.bind(this),
      's3batch:create:create': this.createS3BatchJob.bind(this),
      's3batch:list:list': this.listS3BatchJobs.bind(this),
    };
  }

  createS3BatchIamRole() {
    const config = this.getS3BatchConfig()
    if (config.role && config.role.arn) {
      return BbPromise.resolve()
    }
    const s3BatchIamRole = this.serverless.utils.readFileSync(path.join(__dirname, 's3-batch-execution-role.json'))
    s3BatchIamRole.Properties.RoleName = this.getRoleName();
    if (config.role && config.role.iamRoleStatements) {
      s3BatchIamRole.Properties.Policies[0].PolicyDocument.Statement = config.role.iamRoleStatements
    }

    merge(this.serverless.service.provider.compiledCloudFormationTemplate.Resources, {
      S3BatchIamRole: s3BatchIamRole
    })

    merge(this.serverless.service.provider.compiledCloudFormationTemplate.Outputs, {
      S3BatchIamRole: {
        Value: { "Fn::GetAtt" : ["S3BatchIamRole", "Arn"] },
        Description: "S3 Batch IAM Role ARN"
      }
    })

    return BbPromise.resolve()
  }
  
  createS3BatchJob() {
    this.checkVersion()

    const accountPromise = this.getAccountId()
    const manifestPromise = this.getManifest()
    const operationPromise = this.getOperation()
    const rolePromise = this.getRoleArn()

    return Promise.all([
      accountPromise,
      manifestPromise,
      operationPromise,
      rolePromise
    ]).then(values => {
      const params = {
        AccountId: values[0],
        Manifest: values[1],
        Operation: values[2],
        Priority: this.getPriority(),
        Report: this.getReport(),
        RoleArn: values[3],
        ConfirmationRequired: false
      }
      return this.awsProvider.request('S3Control', 'createJob', params)
        .then((response) => {
          this.serverless.cli.log(`S3 Batch Job created. Job Id: ${response.JobId}`)
          this.serverless.cli.log('')
          this.serverless.cli.log(`View in browser: https://console.aws.amazon.com/s3/jobs/${response.JobId}?region=${this.serverless.service.provider.region}`)
        })
    })
  }

  listS3BatchJobs() {
    this.checkVersion()

    const accountPromise = this.getAccountId()

    return accountPromise
      .then((accountId) => {
        const params = {
          AccountId: accountId
        }
        return this.awsProvider.request('S3Control', 'listJobs', params) })
      .then((response) => console.log(response.Jobs))
  }

  checkVersion() {
    if (!semver.gte(this.awsProvider.sdk.VERSION, '2.447.0')) {
      throw new Error(`Must have AWS SDK version >= '2.448.0' to use S3 Batch API. Your version: ${this.awsProvider.sdk.VERSION}`) 
    }
  }

  getRoleName() {
    const config = this.getS3BatchConfig()
    if (config.role && config.role.name) {
      return config.role.name
    }
    return {
      'Fn::Join': [
        '-',
        [
          this.awsProvider.serverless.service.service,
          this.awsProvider.getStage(),
          { Ref: 'AWS::Region' },
          's3BatchRole',
        ],
      ],
    }
  }

  getPolicyName() {
    return {
      'Fn::Join': [
        '-',
        [
          this.awsProvider.getStage(),
          this.awsProvider.serverless.service.service,
          's3Batch',
        ],
      ],
    };
  }

  getAccountId() {
    const config = this.getS3BatchConfig()
    if (config.accountId){
      return BbPromise.resolve(config.accountId)
    }
    return this.awsProvider.request('STS', 'getCallerIdentity', {})
      .then(response => BbPromise.resolve(response.Account) )
  } 

  async getManifest() {
    const config = this.getS3BatchConfig()

    let location
    if (typeof config.manifest === 'string' && config.manifest.startsWith('s3://')) {
      location = config.manifest
    } else if (config.manifest.location) {
      location = config.manifest.location
    } else {
      throw new Error('Must provide configuration for manifest location.')
    }

    const { bucket, path } = this.parseS3(location)
    if (!path) {
      throw new Error('Missing path in S3 manifest location')
    }
    const objectArn = `arn:aws:s3:::${bucket}/${path}`
    const versionId = config.manifest.version

    const format = config.manifest.format || "csv"

    if (!["csv", "inventory"].includes(format.toLowerCase())) {
      throw new Error(`Invalid configuration for manifest format. You provided ${config.manifest.format}. Valid values are "csv" or "inventory"`)
    }


    const etag = await this.getEtag(bucket, path, versionId)

    const manifest = {
      Location: {
        ETag: etag,
        ObjectArn: objectArn
      },
      Spec: {
        Format: format.toLowerCase() == 'csv' ? 'S3BatchOperations_CSV_20180820' : 'S3InventoryReport_CSV_20161130'
      }
    }
    if (versionId) {
      manifest.Location.ObjectVersionId = versionId
    }
    if (format.toLowerCase() == 'csv') {
      manifest.Spec.Fields = [ 'Bucket', 'Key' ]
    }
    return BbPromise.resolve(manifest)
  }

  async getEtag(bucket, path, versionId) {
    const config = this.getS3BatchConfig()
    if (config.manifest.etag) {
      return BbPromise.resolve(config.manifest.etag)
    }
    const params = {
      Bucket: bucket,
      Key: path
    }
    if (versionId) {
      params.VersionId = versionId
    }
    try {
      const object = await this.awsProvider.request('S3', 'headObject', params)
      return BbPromise.resolve(JSON.parse(object.ETag))
    } catch (e) {
      if (e.providerError.code == 'Forbidden') {
        throw new Error(`You don't have access to manifest object at s3://${bucket}/${path}.`)
      }
      throw new Error('Error fetching ETag: ', e)
    }
  }

  async getOperation() {
    const config = this.getS3BatchConfig()
    const funcName = typeof config.operation === 'string' ? config.operation : config.operation.function
    if (!funcName) {
      throw new Error("Please include an 'operation' parameter in your S3 Batch configuration.")
    }
    if (!(funcName in this.serverless.service.functions)) {
      throw new Error(`Function ${funcName} is not configured in this service and cannot be used in your S3 Batch job.`)
    }
    const outputKey = this.awsProvider.naming.getLambdaVersionOutputLogicalId(funcName)
    const cfnStack = await this.awsProvider.request('CloudFormation', 'describeStacks', {
      StackName: this.awsProvider.naming.getStackName()
    })

    const functionArn = find(
      cfnStack.Stacks[0].Outputs,
      ({ OutputKey }) => OutputKey === outputKey
    ).OutputValue.replace(/:\d+$/, '')
    const operation = {
      LambdaInvoke: {
        FunctionArn: functionArn
      }
    }
    return BbPromise.resolve(operation)
  }

  async getRoleArn() {
    // Bail early if they've provided the role ARN
    const config = this.getS3BatchConfig()
    if (config.role && config.role.arn) {
      return BbPromise.resolve(config.role.arn)
    }

    const cfnStack = await this.awsProvider.request('CloudFormation', 'describeStacks', {
      StackName: this.awsProvider.naming.getStackName()
    })

    const roleArn = find(
      cfnStack.Stacks[0].Outputs,
      ({ OutputKey }) => OutputKey === 'S3BatchIamRole'
    ).OutputValue

    return roleArn
  }
  getReport() {
    const config = this.getS3BatchConfig()

    // If they haven't configured a report, return false early.
    if (!config.report) {
      return {
        Enabled: false
      }
    }

    let location
    if (typeof config.report === 'string' && config.report.startsWith('s3://')) {
      location = config.report
    } else if (config.report.location) {
      location = config.report.location
    } else {
      throw new Error('Must provide configuration for report location.')
    }

    const enabled = config.report.enabled || true
    const scope = config.report.scope || "all"

    if (!["all", "failed"].includes(scope.toLowerCase())) {
      throw new Error(`Invalid configuration for report scope. You provided ${config.report.scope}. Valid values are "all" or "failed"`)
    }

    const { bucket, path } = this.parseS3(location)


    const report = { 
      Enabled: enabled,
      Bucket: `arn:aws:s3:::${bucket}`,
      Format: "Report_CSV_20180820",
      ReportScope: scope.toLowerCase() == 'all' ? "AllTasks" : "FailedTasksOnly"
    }
    if (path) {
      report.Prefix = path
    }
    return report
  }
  getPriority() {
    const config = this.getS3BatchConfig()
    return config.priority || '10'
  } 
  
  getS3BatchConfig() {
    if (!this.serverless.service.custom || !this.serverless.service.custom.s3batch) {
      return {}
    }
    return this.serverless.service.custom.s3batch
  }

  // From s3://my-bucket/my-path, returns 
  //  {
  //    bucket: "my-bucket",
  //    path: "my-path"
  //  }
  parseS3(s3path) {
    const [bucket, path] = s3path.replace(/^(s3:\/\/)/,"").split('/', 2)
    return {
      bucket,
      path
    }
  }

  buildS3Arn(s3path) {
    const { bucket, path } = this.parseS3(s3path)
    if (!path) {
      throw new Error('Missing path in S3 manifest location')
    }
  }
}

module.exports = S3BatchPlugin;
