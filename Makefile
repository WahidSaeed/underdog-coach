.PHONY: build deploy deploy-guided local destroy clean

# data/ lives at the repo root for local dev; CodeUri for the Lambda
# function is backend/, so copy the data in before every build.
build:
	cp -r data backend/data
	sam build
	rm -rf backend/data

# First-ever deploy - prompts for stack name, region, confirms IAM
# changes, and writes your answers into samconfig.toml.
deploy-guided: build
	sam deploy --guided

# Subsequent deploys, using samconfig.toml.
deploy: build
	sam deploy

# Run the API locally against SAM's Lambda emulator (needs Docker).
local: build
	sam local start-api

# Tear down the whole stack.
destroy:
	sam delete --stack-name underdog-coach

clean:
	rm -rf .aws-sam backend/data
