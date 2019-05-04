## Serverless S3 Batch plugin

The `serverless-s3-batch` plugin is designed to make it easy to work with [S3 Batch](https://docs.aws.amazon.com/AmazonS3/latest/dev/batch-ops.html) operations.

If you're running an S3 Batch operation that invokes a Lambda function, you may be using the Serverless Framework to deploy your function anyway. Using the `serverless-s3-batch` plugin also assists with:

- Managing the IAM role for your S3 Batch job

- Launching your S3 Batch job

For a deep dive and walkthrough on S3 Batch and this plugin, check out [this blog post](TODO).

## Installation

#### Install using Serverless plugin manager
```bash
serverless plugin install --name serverless-s3-batch
```

#### Install using npm

Install the module using npm:
```bash
npm install serverless-s3-batch --save-dev
```

Add `serverless-s3-batch` to the plugin list of your `serverless.yml` file:

```yaml
plugins:
  - serverless-s3-batch
```

## 	Quickstart

1. Configure a function and basic usage of the plugin your `serverless.yml`:

	```yaml
	service: s3-batch
	
	plugins:
	  - serverless-s3-batch
	
	custom:
	  s3batch:
	    manifest: s3://s3-batch-example/manifest.txt
	    report: s3://s3-batch-example/reports
	    operation: detectSentiment
	
	provider:
	  name: aws
	  runtime: python3.7
	  stage: dev
	  region: us-east-1
	
	functions:
	  detectSentiment:
	    handler: handler.detect_sentiment
	```
	
2. Deploy your service

	```
	sls deploy
	```
	
	This will deploy your function and create the IAM role to be used for your S3 Batch job.
	
3. Create your S3 Batch job

	```
	sls s3batch create
	
	Serverless: S3 Batch Job created. Job Id: 83e47ce1-0440-4b6c-b36b-284071fafe46
Serverless:
Serverless: View in browser: https://console.aws.amazon.com/s3/jobs/83e47ce1-0440-4b6c-b36b-284071fafe46
	```
	
💥

## Configuration

All configuration goes in the `s3batch` property in the `custom` block.

Example:

```yaml
# serverless.yml
custom:
  s3batch:
    manifest: ...
    ...
```

#### Manifest

Shorthand version:

```yaml
custom:
  s3batch:
    manifest: s3://s3-batch-example/manifest.txt
```

Advanced options:

```yaml
custom:
  s3batch:
    manifest:
      format: csv # "csv" or "inventory". Default is "csv".
      location: s3://s3-batch-example/manifest.txt
      etag: 'ea42026f5e7aaa0addb4f0bb4131d4fb' # Optional. The plugin will fetch the latest ETag if you don't provide it.
```

#### Operation

Shorthand version:

```yaml
custom:
  s3batch:
    operation: myFunc
```
	
The function name must match the name of a function in your `serverless.yml` and the function must be deployed.

Advanced options:

```yaml
custom:
  s3batch:
    operation: 
      function: myFunc
```

I'd like to add support for other operations but haven't yet.

#### Report

Shorthand version:

```yaml
custom:
  s3batch:
    report: s3://s3-batch-example/reports
```

Advanced options:

```yaml
custom:
  s3batch:
    report:
      location: s3://s3-batch-example/reports
      enabled: true # true or false. Defaults to true if a location is provided.
      scope: all # "all" or "failed". Defaults to "all"
      
```

#### Role ARN

The plugin creates a role for use with your S3 Batch job.

By default, it creates a role named `<service>-<stage>-<region>-s3BatchRole`. You can specify your own name if you want:

```yaml
custom:
  s3batch:
    role:
      name: myS3BatchRoleName
```

The role configures a policy with the following IAM statement:

```json
{
  "Effect": "Allow",
  "Action": [
    "s3:GetObject",
    "s3:GetObjectVersion",
    "s3:PutObject",
    "lambda:InvokeFunction"
  ],
  "Resource": "*"
}
```

This will allow your role to read a manifest, invoke a Lambda function for the operation, and write the report at the end.

If you'd like to customize the IAM statement, you may do so with the following:

```yaml
custom:
  s3batch:
    role:
      iamRoleStatements:
        - Effect: Allow
        - Action:
        		- s3:GetObject
        - Resource: "arn:aws:s3:::my_bucket"
```

**Note that this will entirely replace the default IAM statement, so make sure you have all permissions you need for your job.**

To disable IAM creation behavior and bring your own role, provide a Role ARN in the configuration:

```yaml
custom:
  s3batch:
    role:
      arn: arn:aws:iam::123456789012:role/S3BatchRole
```

## Future improvements:

- Ability to run any S3 Batch operation, not just Lambda function operation.