provider "aws" {
  region = var.region
  default_tags {
    tags = {
      project     = "trainme"
      environment = var.environment
      managed-by  = "terraform"
    }
  }
}
