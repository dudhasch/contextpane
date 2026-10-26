# ---------------------------------------------------------------------------
# ContextPane demo baseline — Fabrikam Legal Sovereign Landing Zone (tenant-fabrikam-02)
#
# Expected (clean) state for the Fabrikam hub NSG. Fabrikam is never seeded
# into a live tenant; it exists to prove the zero-token Tier 0 tenant switch
# and that every catalog component hydrates from a second data set.
# ---------------------------------------------------------------------------

locals {
  fabrikam_tags = {
    Environment    = "Production"
    Owner          = "ContextPane"
    CostCenter     = "LEG-4099"
    DataResidency  = "CH"
    Classification = "Confidential"
    ManagedBy      = "Terraform"
  }
}

resource "azurerm_resource_group" "fabrikam_slz_prod" {
  name     = "rg-fabrikam-slz-prod"
  location = "switzerlandnorth"
  tags     = local.fabrikam_tags
}

resource "azurerm_network_security_group" "fabrikam_slz_hub" {
  name                = "nsg-fabrikam-slz-hub-01"
  location            = azurerm_resource_group.fabrikam_slz_prod.location
  resource_group_name = azurerm_resource_group.fabrikam_slz_prod.name
  tags                = local.fabrikam_tags

  security_rule {
    name                       = "Allow-Purview-Egress"
    priority                   = 100
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "VirtualNetwork"
    destination_address_prefix = "AzureCloud.switzerlandnorth"
  }

  security_rule {
    name                       = "Allow-Bastion-SSH"
    priority                   = 200
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = "10.40.250.0/26"
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

output "fabrikam_nsg_id" {
  value = azurerm_network_security_group.fabrikam_slz_hub.id
}
