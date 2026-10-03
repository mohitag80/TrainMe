terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.67" }
  }
  # State in S3 with native lock file (no DynamoDB table needed). Create the bucket once, then:
  #   tofu init -backend-config="bucket=<state-bucket>" -backend-config="region=<region>"
  backend "s3" {
    key          = "trainme/beta/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}
