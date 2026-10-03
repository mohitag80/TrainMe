output "cluster_name" { value = module.eks.cluster_name }
output "cluster_endpoint" { value = module.eks.cluster_endpoint }
output "postgres_endpoint" { value = module.rds.db_instance_endpoint }
output "postgres_master_secret_arn" { value = module.rds.db_instance_master_user_secret_arn }
output "valkey_endpoint" { value = aws_elasticache_replication_group.cache.primary_endpoint_address }
output "kafka_bootstrap_brokers_iam" { value = aws_msk_cluster.events.bootstrap_brokers_sasl_iam }
output "ecr_repositories" { value = { for k, r in aws_ecr_repository.service : k => r.repository_url } }
output "exports_bucket" { value = aws_s3_bucket.exports.bucket }
