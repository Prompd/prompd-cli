# Terraform Infrastructure as Code for Prompd Workflow Engine
terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.0"
    }
  }
  
  backend "s3" {
    bucket = "prompd-terraform-state"
    key    = "prompd-workflow-engine/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = var.aws_region
  
  default_tags {
    tags = {
      Project     = "prompd-workflow-engine"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# Variables
variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "prod"
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "cluster_name" {
  description = "EKS cluster name"
  type        = string
  default     = "prompd-cluster"
}

variable "node_instance_type" {
  description = "EC2 instance type for EKS nodes"
  type        = string
  default     = "t3.medium"
}

variable "desired_capacity" {
  description = "Desired number of EKS nodes"
  type        = number
  default     = 3
}

variable "max_capacity" {
  description = "Maximum number of EKS nodes"
  type        = number
  default     = 10
}

variable "min_capacity" {
  description = "Minimum number of EKS nodes"
  type        = number
  default     = 2
}

# VPC Configuration
resource "aws_vpc" "prompd_vpc" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  
  tags = {
    Name = "prompd-vpc-${var.environment}"
  }
}

resource "aws_internet_gateway" "prompd_igw" {
  vpc_id = aws_vpc.prompd_vpc.id
  
  tags = {
    Name = "prompd-igw-${var.environment}"
  }
}

resource "aws_subnet" "prompd_public_subnet" {
  count                   = 2
  vpc_id                  = aws_vpc.prompd_vpc.id
  cidr_block              = "10.0.${count.index + 1}.0/24"
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  
  tags = {
    Name = "prompd-public-subnet-${count.index + 1}-${var.environment}"
    Type = "Public"
    "kubernetes.io/role/elb" = "1"
  }
}

resource "aws_subnet" "prompd_private_subnet" {
  count             = 2
  vpc_id            = aws_vpc.prompd_vpc.id
  cidr_block        = "10.0.${count.index + 10}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]
  
  tags = {
    Name = "prompd-private-subnet-${count.index + 1}-${var.environment}"
    Type = "Private"
    "kubernetes.io/role/internal-elb" = "1"
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

# NAT Gateway
resource "aws_eip" "prompd_nat" {
  count  = 2
  domain = "vpc"
  
  tags = {
    Name = "prompd-nat-eip-${count.index + 1}-${var.environment}"
  }
}

resource "aws_nat_gateway" "prompd_nat" {
  count         = 2
  allocation_id = aws_eip.prompd_nat[count.index].id
  subnet_id     = aws_subnet.prompd_public_subnet[count.index].id
  
  tags = {
    Name = "prompd-nat-${count.index + 1}-${var.environment}"
  }
  
  depends_on = [aws_internet_gateway.prompd_igw]
}

# Route Tables
resource "aws_route_table" "prompd_public" {
  vpc_id = aws_vpc.prompd_vpc.id
  
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.prompd_igw.id
  }
  
  tags = {
    Name = "prompd-public-rt-${var.environment}"
  }
}

resource "aws_route_table" "prompd_private" {
  count  = 2
  vpc_id = aws_vpc.prompd_vpc.id
  
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.prompd_nat[count.index].id
  }
  
  tags = {
    Name = "prompd-private-rt-${count.index + 1}-${var.environment}"
  }
}

resource "aws_route_table_association" "prompd_public" {
  count          = 2
  subnet_id      = aws_subnet.prompd_public_subnet[count.index].id
  route_table_id = aws_route_table.prompd_public.id
}

resource "aws_route_table_association" "prompd_private" {
  count          = 2
  subnet_id      = aws_subnet.prompd_private_subnet[count.index].id
  route_table_id = aws_route_table.prompd_private[count.index].id
}

# Security Groups
resource "aws_security_group" "prompd_eks_cluster" {
  name_prefix = "prompd-eks-cluster-"
  vpc_id      = aws_vpc.prompd_vpc.id
  
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  tags = {
    Name = "prompd-eks-cluster-sg-${var.environment}"
  }
}

resource "aws_security_group" "prompd_eks_nodes" {
  name_prefix = "prompd-eks-nodes-"
  vpc_id      = aws_vpc.prompd_vpc.id
  
  ingress {
    from_port = 0
    to_port   = 65535
    protocol  = "tcp"
    self      = true
  }
  
  ingress {
    from_port       = 1025
    to_port         = 65535
    protocol        = "tcp"
    security_groups = [aws_security_group.prompd_eks_cluster.id]
  }
  
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  tags = {
    Name = "prompd-eks-nodes-sg-${var.environment}"
  }
}

# EKS Cluster
resource "aws_eks_cluster" "prompd_cluster" {
  name     = var.cluster_name
  role_arn = aws_iam_role.prompd_cluster.arn
  version  = "1.28"
  
  vpc_config {
    subnet_ids              = concat(aws_subnet.prompd_public_subnet[*].id, aws_subnet.prompd_private_subnet[*].id)
    security_group_ids      = [aws_security_group.prompd_eks_cluster.id]
    endpoint_private_access = true
    endpoint_public_access  = true
    public_access_cidrs     = ["0.0.0.0/0"]
  }
  
  encryption_config {
    provider {
      key_arn = aws_kms_key.prompd_eks.arn
    }
    resources = ["secrets"]
  }
  
  enabled_cluster_log_types = ["api", "audit", "authenticator", "controllerManager", "scheduler"]
  
  depends_on = [
    aws_iam_role_policy_attachment.prompd_cluster_AmazonEKSClusterPolicy,
    aws_iam_role_policy_attachment.prompd_cluster_AmazonEKSVPCResourceController,
    aws_cloudwatch_log_group.prompd_cluster,
  ]
  
  tags = {
    Name = "prompd-cluster-${var.environment}"
  }
}

# EKS Node Group
resource "aws_eks_node_group" "prompd_nodes" {
  cluster_name    = aws_eks_cluster.prompd_cluster.name
  node_group_name = "prompd-nodes"
  node_role_arn   = aws_iam_role.prompd_nodes.arn
  subnet_ids      = aws_subnet.prompd_private_subnet[*].id
  instance_types  = [var.node_instance_type]
  ami_type        = "AL2_x86_64"
  capacity_type   = "ON_DEMAND"
  disk_size       = 20
  
  scaling_config {
    desired_size = var.desired_capacity
    max_size     = var.max_capacity
    min_size     = var.min_capacity
  }
  
  update_config {
    max_unavailable = 1
  }
  
  depends_on = [
    aws_iam_role_policy_attachment.prompd_nodes_AmazonEKSWorkerNodePolicy,
    aws_iam_role_policy_attachment.prompd_nodes_AmazonEKS_CNI_Policy,
    aws_iam_role_policy_attachment.prompd_nodes_AmazonEC2ContainerRegistryReadOnly,
  ]
  
  tags = {
    Name = "prompd-node-group-${var.environment}"
  }
}

# IAM Roles
resource "aws_iam_role" "prompd_cluster" {
  name = "prompd-cluster-role-${var.environment}"
  
  assume_role_policy = jsonencode({
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "eks.amazonaws.com"
      }
    }]
    Version = "2012-10-17"
  })
}

resource "aws_iam_role_policy_attachment" "prompd_cluster_AmazonEKSClusterPolicy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
  role       = aws_iam_role.prompd_cluster.name
}

resource "aws_iam_role_policy_attachment" "prompd_cluster_AmazonEKSVPCResourceController" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSVPCResourceController"
  role       = aws_iam_role.prompd_cluster.name
}

resource "aws_iam_role" "prompd_nodes" {
  name = "prompd-node-group-role-${var.environment}"
  
  assume_role_policy = jsonencode({
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
    Version = "2012-10-17"
  })
}

resource "aws_iam_role_policy_attachment" "prompd_nodes_AmazonEKSWorkerNodePolicy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
  role       = aws_iam_role.prompd_nodes.name
}

resource "aws_iam_role_policy_attachment" "prompd_nodes_AmazonEKS_CNI_Policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
  role       = aws_iam_role.prompd_nodes.name
}

resource "aws_iam_role_policy_attachment" "prompd_nodes_AmazonEC2ContainerRegistryReadOnly" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
  role       = aws_iam_role.prompd_nodes.name
}

# KMS Key for encryption
resource "aws_kms_key" "prompd_eks" {
  description = "EKS Secret Encryption Key"
  
  tags = {
    Name = "prompd-eks-key-${var.environment}"
  }
}

resource "aws_kms_alias" "prompd_eks" {
  name          = "alias/prompd-eks-${var.environment}"
  target_key_id = aws_kms_key.prompd_eks.key_id
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "prompd_cluster" {
  name              = "/aws/eks/${var.cluster_name}/cluster"
  retention_in_days = 14
}

# ECR Repository
resource "aws_ecr_repository" "prompd_workflow_engine" {
  name                 = "prompd/workflow-engine"
  image_tag_mutability = "MUTABLE"
  
  image_scanning_configuration {
    scan_on_push = true
  }
  
  encryption_configuration {
    encryption_type = "AES256"
  }
  
  lifecycle_policy {
    policy = jsonencode({
      rules = [
        {
          rulePriority = 1
          description  = "Keep last 10 images"
          selection = {
            tagStatus     = "tagged"
            tagPrefixList = ["v"]
            countType     = "imageCountMoreThan"
            countNumber   = 10
          }
          action = {
            type = "expire"
          }
        }
      ]
    })
  }
}

# RDS for PostgreSQL (optional)
resource "aws_db_subnet_group" "prompd_db" {
  name       = "prompd-db-subnet-group-${var.environment}"
  subnet_ids = aws_subnet.prompd_private_subnet[*].id
  
  tags = {
    Name = "prompd-db-subnet-group-${var.environment}"
  }
}

resource "aws_security_group" "prompd_rds" {
  name_prefix = "prompd-rds-"
  vpc_id      = aws_vpc.prompd_vpc.id
  
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.prompd_eks_nodes.id]
  }
  
  tags = {
    Name = "prompd-rds-sg-${var.environment}"
  }
}

resource "aws_db_instance" "prompd_db" {
  identifier                = "prompd-db-${var.environment}"
  engine                    = "postgres"
  engine_version            = "15.4"
  instance_class            = "db.t3.micro"
  allocated_storage         = 20
  max_allocated_storage     = 100
  storage_type              = "gp2"
  storage_encrypted         = true
  kms_key_id               = aws_kms_key.prompd_eks.arn
  
  db_name  = "prompd"
  username = "prompd"
  password = random_password.db_password.result
  
  vpc_security_group_ids = [aws_security_group.prompd_rds.id]
  db_subnet_group_name   = aws_db_subnet_group.prompd_db.name
  
  backup_retention_period = 7
  backup_window          = "03:00-04:00"
  maintenance_window     = "sun:04:00-sun:05:00"
  
  skip_final_snapshot = false
  final_snapshot_identifier = "prompd-db-final-snapshot-${formatdate("YYYY-MM-DD-hhmm", timestamp())}"
  
  tags = {
    Name = "prompd-db-${var.environment}"
  }
}

resource "random_password" "db_password" {
  length  = 16
  special = true
}

# Redis ElastiCache
resource "aws_elasticache_subnet_group" "prompd_redis" {
  name       = "prompd-redis-subnet-group-${var.environment}"
  subnet_ids = aws_subnet.prompd_private_subnet[*].id
}

resource "aws_security_group" "prompd_redis" {
  name_prefix = "prompd-redis-"
  vpc_id      = aws_vpc.prompd_vpc.id
  
  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.prompd_eks_nodes.id]
  }
  
  tags = {
    Name = "prompd-redis-sg-${var.environment}"
  }
}

resource "aws_elasticache_replication_group" "prompd_redis" {
  replication_group_id       = "prompd-redis-${var.environment}"
  description                = "Redis cluster for Prompd workflow engine"
  
  node_type                  = "cache.t3.micro"
  port                       = 6379
  parameter_group_name       = "default.redis7"
  
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled          = true
  
  subnet_group_name = aws_elasticache_subnet_group.prompd_redis.name
  security_group_ids = [aws_security_group.prompd_redis.id]
  
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  
  tags = {
    Name = "prompd-redis-${var.environment}"
  }
}

# Outputs
output "cluster_endpoint" {
  description = "Endpoint for EKS control plane"
  value       = aws_eks_cluster.prompd_cluster.endpoint
}

output "cluster_security_group_id" {
  description = "Security group ids attached to the cluster control plane"
  value       = aws_eks_cluster.prompd_cluster.vpc_config[0].cluster_security_group_id
}

output "cluster_certificate_authority_data" {
  description = "Base64 encoded certificate data required to communicate with the cluster"
  value       = aws_eks_cluster.prompd_cluster.certificate_authority[0].data
}

output "ecr_repository_url" {
  description = "ECR repository URL"
  value       = aws_ecr_repository.prompd_workflow_engine.repository_url
}

output "rds_endpoint" {
  description = "RDS instance endpoint"
  value       = aws_db_instance.prompd_db.endpoint
}

output "redis_endpoint" {
  description = "Redis cluster endpoint"
  value       = aws_elasticache_replication_group.prompd_redis.configuration_endpoint_address
}