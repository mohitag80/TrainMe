variable "region" {
  description = "AWS region (open question: launch geography; ap-south-1 is only an example)"
  type        = string
  default     = "ap-south-1"
}

variable "environment" {
  type    = string
  default = "beta"
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "kubernetes_version" {
  type    = string
  default = "1.34"
}

variable "db_instance_class" {
  description = "docs/04 §3.4: db.m7g.large, db.m7g.xlarge above ~5K daily active users"
  type        = string
  default     = "db.m7g.large"
}

variable "db_allocated_storage_gb" {
  type    = number
  default = 500
}

variable "msk_broker_instance_type" {
  type    = string
  default = "kafka.t3.small"
}

variable "services" {
  description = "One ECR repository per service image"
  type        = list(string)
  default     = ["catalog-svc", "tracker-svc", "records-svc", "analytics-svc", "user-profile-svc", "subscription-svc", "notification-svc", "web"]
}
