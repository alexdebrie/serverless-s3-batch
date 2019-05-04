import boto3

s3 = boto3.client('s3')
comprehend = boto3.client('comprehend')


def detect_sentiment(event, context):
    task = event['tasks'][0]
    taskId = task['taskId']

    obj = s3.get_object(
        Bucket=task['s3BucketArn'].split(':')[-1],
        Key=task['s3Key']
    )
    text = obj['Body'].read().decode('utf-8')
    resp = comprehend.detect_sentiment(
        Text=text,
        LanguageCode='en'
    )

    results = [{
        'taskId': taskId,
        'resultCode': 'Succeeded',
        'resultString': resp['Sentiment']
    }]
    return {
        'invocationSchemaVersion': event['invocationSchemaVersion'],
        'treatMissingKeysAs': 'PermanentFailure',
        'invocationId': event['invocationId'],
        'results': results
    }
