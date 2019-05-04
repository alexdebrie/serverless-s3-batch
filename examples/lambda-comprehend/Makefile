upload: gen-manifest
	@aws s3 cp files/ s3://${S3_BATCH_BUCKET} --recursive

gen-manifest:
	@echo '${S3_BATCH_BUCKET},think-of-love.txt\n${S3_BATCH_BUCKET},julius-caesar.txt\n${S3_BATCH_BUCKET},little-rascals.txt' > files/manifest.txt
