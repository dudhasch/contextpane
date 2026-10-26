# ---------------------------------------------------------------------------
# ContextPane demo baseline — Contoso Finance AVD (tenant-contoso-01)
#
# This file is the *expected* (clean) state. mcp-azure-iac compares it against
# the live NSG (LIVE_CLOUD_MODE=true) or the seeded drifted state in
# demo-lab-manifest.json (LIVE_CLOUD_MODE=false) and renders a unified HCL diff.
#
# Tier 3 remediation stages a patch against this file on a fix/* branch.
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

provider "azurerm" {
  features {}
}

locals {
  contoso_tags = {
    Environment = "Production"
    Owner       = "ContextPane"
    CostCenter  = "FIN-4092"
    Workload    = "AVD-HostPool"
    ManagedBy   = "Terraform"
  }
}

resource "azurerm_resource_group" "contoso_avd_prod" {
  name     = "rg-contoso-avd-prod"
  location = "westeurope"
  tags     = local.contoso_tags
}

resource "azurerm_network_security_group" "contoso_avd_hostpool" {
  name                = "nsg-contoso-avd-hostpool-01"
  location            = azurerm_resource_group.contoso_avd_prod.location
  resource_group_name = azurerm_resource_group.contoso_avd_prod.name
  tags                = local.contoso_tags

  security_rule {
    name                       = "Allow-AVD-ServiceTraffic"
    priority                   = 100
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "VirtualNetwork"
    destination_address_prefix = "WindowsVirtualDesktop"
  }

  security_rule {
    name                       = "Allow-Internal-RDP-Shortpath"
    priority                   = 200
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Udp"
    source_port_range          = "*"
    destination_port_range     = "3390"
    source_address_prefix      = "10.20.0.0/16"
    destination_address_prefix = "VirtualNetwork"
  }

  security_rule {
    name                       = "Deny-All-Inbound-Internet"
    priority                   = 4000
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "Internet"
    destination_address_prefix = "*"
  }
}

output "contoso_nsg_id" {
  value = azurerm_network_security_group.contoso_avd_hostpool.id
}
