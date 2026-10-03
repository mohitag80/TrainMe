# AWS beta environment (docs/04 §3, diagram 10): two AZs, private EKS nodes, managed data services.
locals {
  name = "trainme-${var.environment}"
  azs  = slice(data.aws_availability_zones.available.names, 0, 2)
}

data "aws_availability_zones" "available" {
  state = "available"
}

# ------------------------------------------------------------------ network
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 6.7"

  name = local.name
  cidr = var.vpc_cidr
  azs  = local.azs

  public_subnets   = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 8, i)]
  private_subnets  = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 4, i + 1)]
  database_subnets = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 8, i + 100)]

  enable_nat_gateway           = true
  single_nat_gateway           = true # beta cost saving; one per AZ for GA
  create_database_subnet_group = true

  public_subnet_tags  = { "kubernetes.io/role/elb" = 1 }
  private_subnet_tags = { "kubernetes.io/role/internal-elb" = 1, "karpenter.sh/discovery" = local.name }
}

# ------------------------------------------------------------------ Kubernetes
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 21.26"

  name               = local.name
  kubernetes_version = var.kubernetes_version
  vpc_id             = module.vpc.vpc_id
  subnet_ids         = module.vpc.private_subnets

  endpoint_public_access                   = true
  enable_cluster_creator_admin_permissions = true

  addons = {
    coredns                = {}
    kube-proxy             = {}
    vpc-cni                = { before_compute = true }
    eks-pod-identity-agent = { before_compute = true }
    aws-ebs-csi-driver     = {}
  }

  # Small fixed group for system pods (Karpenter, CoreDNS); Karpenter provisions app capacity.
  eks_managed_node_groups = {
    system = {
      instance_types = ["m7g.large"]
      ami_type       = "AL2023_ARM_64_STANDARD"
      min_size       = 2
      max_size       = 3
      desired_size   = 2
      labels         = { "trainme.app/pool" = "system" }
    }
  }

  node_security_group_tags = { "karpenter.sh/discovery" = local.name }
}

module "karpenter" {
  source  = "terraform-aws-modules/eks/aws//modules/karpenter"
  version = "~> 21.26"

  cluster_name                    = module.eks.cluster_name
  create_pod_identity_association = true
  node_iam_role_additional_policies = {
    AmazonSSMManagedInstanceCore = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
  }
}

# ------------------------------------------------------------------ PostgreSQL (one instance, one DB per service)
module "rds" {
  source  = "terraform-aws-modules/rds/aws"
  version = "~> 7.2"

  identifier     = "${local.name}-pg"
  engine         = "postgres"
  engine_version = "17"
  family         = "postgres17"
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage_gb
  max_allocated_storage = var.db_allocated_storage_gb * 2
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name                     = "trainme_admin"
  username                    = "trainme_admin"
  manage_master_user_password = true # stored in Secrets Manager
  port                        = 5432

  multi_az               = true
  db_subnet_group_name   = module.vpc.database_subnet_group_name
  vpc_security_group_ids = [aws_security_group.data.id]

  backup_retention_period      = 7
  performance_insights_enabled = true
  deletion_protection          = true
  skip_final_snapshot          = false

  # Same tuning as k3s (08 §8); pg_partman_bgw maintains records_db partitions.
  parameters = [
    { name = "shared_preload_libraries", value = "pg_stat_statements,auto_explain,pg_partman_bgw", apply_method = "pending-reboot" },
    { name = "pg_partman_bgw.interval", value = "3600", apply_method = "pending-reboot" },
    { name = "pg_partman_bgw.role", value = "records_svc", apply_method = "pending-reboot" },
    { name = "pg_partman_bgw.dbname", value = "records_db", apply_method = "pending-reboot" },
    { name = "auto_explain.log_min_duration", value = "500" },
    { name = "random_page_cost", value = "1.1" },
    { name = "jit", value = "0" },
    { name = "work_mem", value = "32768" },
  ]
}

# ------------------------------------------------------------------ Valkey (cache)
resource "aws_elasticache_subnet_group" "cache" {
  name       = "${local.name}-cache"
  subnet_ids = module.vpc.database_subnets
}

resource "aws_elasticache_replication_group" "cache" {
  replication_group_id       = "${local.name}-cache"
  description                = "TrainMe cache (cache-aside, never the source of truth)"
  engine                     = "valkey"
  engine_version             = "8.1"
  node_type                  = "cache.t4g.small"
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true
  subnet_group_name          = aws_elasticache_subnet_group.cache.name
  security_group_ids         = [aws_security_group.data.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  port                       = 6379
}

# ------------------------------------------------------------------ Kafka (MSK)
resource "aws_msk_cluster" "events" {
  cluster_name           = "${local.name}-events"
  kafka_version          = "3.8.x"
  number_of_broker_nodes = 2 # one per AZ; docs/04 suggests 3 brokers once a third AZ is added

  broker_node_group_info {
    instance_type   = var.msk_broker_instance_type
    client_subnets  = module.vpc.private_subnets
    security_groups = [aws_security_group.data.id]
    storage_info {
      ebs_storage_info { volume_size = 100 }
    }
  }

  encryption_info {
    encryption_in_transit {
      client_broker = "TLS"
      in_cluster    = true
    }
  }

  client_authentication {
    sasl { iam = true }
  }
}

# ------------------------------------------------------------------ security group for data services
resource "aws_security_group" "data" {
  name        = "${local.name}-data"
  description = "PostgreSQL, Valkey and MSK: reachable from EKS nodes only"
  vpc_id      = module.vpc.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "from_nodes" {
  for_each = { postgres = 5432, valkey = 6379, msk_iam = 9098 }

  security_group_id            = aws_security_group.data.id
  referenced_security_group_id = module.eks.node_security_group_id
  from_port                    = each.value
  to_port                      = each.value
  ip_protocol                  = "tcp"
  description                  = each.key
}

# ------------------------------------------------------------------ images and objects
resource "aws_ecr_repository" "service" {
  for_each             = toset(var.services)
  name                 = "trainme/${each.value}"
  image_tag_mutability = "IMMUTABLE" # tags are git SHAs (docs/04 §4)
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "AES256" }
}

resource "aws_ecr_lifecycle_policy" "service" {
  for_each   = aws_ecr_repository.service
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "keep the last 30 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 30 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_s3_bucket" "exports" {
  bucket_prefix = "${local.name}-exports-"
}

resource "aws_s3_bucket_public_access_block" "exports" {
  bucket                  = aws_s3_bucket.exports.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "exports" {
  bucket = aws_s3_bucket.exports.id
  rule {
    id     = "expire-exports"
    status = "Enabled"
    filter {}
    expiration { days = 7 } # export links are valid for 7 days (FR-PRF-03)
  }
}
