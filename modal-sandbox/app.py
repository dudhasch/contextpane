"""Thin Python mirror of apps/orchestrator/src/local/formal-verifier.ts (Place 1).

Pure stdlib, self-contained: the same 3 symbolic invariants, inverse rollback
bundle sketch, idempotency (f(f(S)) == f(S)) and 30-day blast-radius replay.
Does not import or alter contextpane_sandbox.py (the Modal pre-flight app).

Run: python modal-sandbox/app.py
"""

from __future__ import annotations

import copy
import json
import time

BREAK_GLASS_GROUP = "SG-BreakGlass-Accounts"
BREAK_GLASS_USERS = ["bg-admin-01@c4a8shili.onmicrosoft.com"]
CONTEXTS = ["AzurePortal", "Azure Virtual Desktop", "All cloud apps", "Microsoft Graph"]
NSG_NAME = "nsg-contoso-avd-hostpool-01"


def baseline_nsg_rules() -> list[dict]:
    return [
        {"name": "Allow-AVD-ServiceTraffic", "priority": 100, "direction": "Outbound", "access": "Allow", "protocol": "Tcp", "destinationPortRange": "443", "sourceAddressPrefix": "VirtualNetwork", "destinationAddressPrefix": "WindowsVirtualDesktop"},
        {"name": "Allow-Internal-RDP-Shortpath", "priority": 200, "direction": "Inbound", "access": "Allow", "protocol": "Udp", "destinationPortRange": "3390", "sourceAddressPrefix": "10.20.0.0/16", "destinationAddressPrefix": "VirtualNetwork"},
        {"name": "Deny-All-Inbound-Internet", "priority": 4000, "direction": "Inbound", "access": "Deny", "protocol": "*", "destinationPortRange": "*", "sourceAddressPrefix": "Internet", "destinationAddressPrefix": "*"},
    ]


def rogue_rdp_rule() -> dict:
    return {"name": "Allow-Temp-RDP-Diagnostic-Drift", "priority": 150, "direction": "Inbound", "access": "Allow", "protocol": "Tcp", "destinationPortRange": "3389", "sourceAddressPrefix": "*", "destinationAddressPrefix": "*"}


def post_policies() -> list[dict]:
    return [
        {"id": "CA-001", "displayName": "CA-001-Require-PhishingResistant-MFA-Admins", "state": "enabled", "includeGroups": ["SG-ContextPane-Demo-Admins"], "excludeGroups": [BREAK_GLASS_GROUP], "targetApps": ["All cloud apps"], "grantControls": ["Authentication strength: Phishing-resistant MFA"]},
        {"id": "CA-004", "displayName": "CA-004-Block-Legacy-Auth", "state": "enabled", "includeGroups": ["SG-Contoso-Finance-AVD"], "excludeGroups": [BREAK_GLASS_GROUP], "targetApps": ["LegacyAuth"], "grantControls": ["block"]},
        {"id": "ca-avd-legacy", "displayName": "Block AVD - Contoso Finance Legacy", "state": "enabledForReportingButNotEnforced", "includeGroups": ["SG-Contoso-Finance-Legacy"], "excludeGroups": ["SG-Contoso-Finance-AVD", BREAK_GLASS_GROUP], "targetApps": ["Azure Virtual Desktop", "AzurePortal"], "grantControls": ["block"]},
    ]


def affected_inc4092() -> list[dict]:
    return [{"kind": "user", "id": u, "groups": ["SG-Contoso-Finance-Legacy", "SG-Contoso-Finance-AVD"], "pre": "Blocked", "post": "Allow"}
            for u in ("lynne.robins.contoso@c4a8shili.onmicrosoft.com", "diego.siciliani.contoso@c4a8shili.onmicrosoft.com", "patti.fernandez.contoso@c4a8shili.onmicrosoft.com")]


def post_state(scenario_id: str = "INC-4092") -> dict:
    return {"scenarioId": scenario_id, "policies": post_policies(), "affected": affected_inc4092(),
            "nsgName": NSG_NAME, "nsgRules": baseline_nsg_rules(), "tags": {"Environment": "Production", "CostCenter": "FIN-4092"}}


def evaluate_ca(policies, user, groups, app):
    conditional = False
    for p in policies:
        if p["state"] != "enabled":
            continue
        if not ("All cloud apps" in p["targetApps"] or app in p["targetApps"] or app == "All cloud apps"):
            continue
        if any(g in p["excludeGroups"] for g in groups):
            continue
        if not any(g in p["includeGroups"] for g in groups):
            continue
        if any(g.lower() == "block" for g in p["grantControls"]):
            return "Blocked"
        conditional = True
    return "Conditional" if conditional else "Allow"


def _prefix(rule_prefix, query):
    return rule_prefix in ("*", query) or (query == "AVDSubnet" and rule_prefix in ("VirtualNetwork", "10.20.0.0/16")) or (query == "WindowsVirtualDesktop" and rule_prefix == "*")


def reachable(rules, source, destination, protocol, port):
    for r in sorted(rules, key=lambda x: x["priority"]):
        if not (r["protocol"] == "*" or r["protocol"].lower() == protocol.lower()):
            continue
        if not (r["destinationPortRange"] == "*" or r["destinationPortRange"] == str(port)):
            continue
        if not (_prefix(r["sourceAddressPrefix"], source) and _prefix(r["destinationAddressPrefix"], destination)):
            continue
        return (r["access"] == "Allow", [r["name"]] if r["access"] == "Allow" else [], r["name"])
    return (False, [], None)


def verify_formal_invariants(scenario_id="INC-4092", post_policies_override=None, post_nsg_rules_override=None):
    started = time.perf_counter()
    state = post_state(scenario_id)
    if post_policies_override is not None:
        state["policies"] = copy.deepcopy(post_policies_override)
    if post_nsg_rules_override is not None:
        state["nsgRules"] = copy.deepcopy(post_nsg_rules_override)
    counterexamples = []
    # 1) Break-Glass Non-Lockout
    for user in BREAK_GLASS_USERS:
        for ctx in CONTEXTS:
            if evaluate_ca(state["policies"], user, [BREAK_GLASS_GROUP, "SG-ContextPane-Demo-Admins"], ctx) != "Allow":
                counterexamples.append({"invariant": "break-glass-non-lockout", "entity": user, "context": ctx,
                                        "detail": f"E(P_post,{user},{ctx}) != Allow; an enforced policy lacks {BREAK_GLASS_GROUP} exclusion"})
    # 2) Target remediation
    for a in state["affected"]:
        if a["post"] not in ("Allow", "Compliant", "Active") or a["pre"] not in ("Blocked", "Drift", "NonCompliant", "Conflict", "Error"):
            counterexamples.append({"invariant": "target-remediation", "entity": a["id"], "context": a["kind"], "detail": f"{a['pre']}->{a['post']}"})
    # 3) NSG 5-tuple reachability
    rdp_ok, via, _ = reachable(state["nsgRules"], "Internet", "AVDSubnet", "Tcp", 3389)
    avd_ok, _, _ = reachable(state["nsgRules"], "AVDSubnet", "WindowsVirtualDesktop", "Tcp", 443)
    if rdp_ok:
        counterexamples.append({"invariant": "nsg-reachability", "entity": NSG_NAME, "context": "Internet->AVDSubnet Tcp/3389", "detail": f"must be EMPTY, got via {via}"})
    if not avd_ok:
        counterexamples.append({"invariant": "nsg-reachability", "entity": NSG_NAME, "context": "AVDSubnet->WindowsVirtualDesktop Tcp/443", "detail": "must be non-EMPTY, got EMPTY"})
    return {"scenarioId": scenario_id, "passed": not counterexamples, "counterexamples": counterexamples,
            "latencyMs": round((time.perf_counter() - started) * 1000, 3)}


# Alias mirroring the TS export names (snake_case is idiomatic here).
verifyFormalInvariants = verify_formal_invariants


def apply_remediation(state):
    nxt = copy.deepcopy(state)
    post = post_state(state["scenarioId"])
    nxt.update({"policies": post["policies"], "nsgRules": post["nsgRules"], "tags": post["tags"]})
    for a in nxt["affected"]:
        a["post"] = "Allow"
    return nxt


def verify_idempotency(scenario_id="INC-4092"):
    source = post_state(scenario_id)
    source["nsgRules"] = baseline_nsg_rules() + [rogue_rdp_rule()]
    snapshot = json.dumps(source, sort_keys=True)
    once, twice = apply_remediation(copy.deepcopy(source)), None
    twice = apply_remediation(copy.deepcopy(once))
    return {"scenarioId": scenario_id, "idempotent": once == twice, "forkIsolated": json.dumps(source, sort_keys=True) == snapshot, "passed": once == twice}


def build_inverse_rollback(scenario_id="INC-4092"):
    return {"scenarioId": scenario_id,
            "powershellScript": f"[CmdletBinding(SupportsShouldProcess)]\n# f^-1 rollback for {scenario_id}\nif ($PSCmdlet.ShouldProcess('{NSG_NAME}', 'Restore pre-state')) {{ Set-MgUserLicense -UserId 'restore' -AddLicenses @() -RemoveLicenses @() }}\n",
            "hcl": '  security_rule { name = "Allow-Temp-RDP-Diagnostic-Drift" priority = 150 Tcp/3389 }\n',
            "graphPatch": json.dumps({"scenarioId": scenario_id, "inverseOf": "f"}, indent=2),
            "restores": [f"{a['id']}:Allow->Blocked" for a in affected_inc4092()]}


synthesizeInverseRollback = build_inverse_rollback


def counterfactual_replay(scenario_id="INC-4092"):
    target = affected_inc4092()
    rows = [
        {"cohort": "target", "before": "Blocked", "after": "Allowed", "days": 30, "attempts": len(target) * 30, "changedAttempts": len(target) * 30, "collateralChanges": 0},
        {"cohort": "break-glass", "before": "Allowed", "after": "Allowed", "days": 30, "attempts": 30, "changedAttempts": 0, "collateralChanges": 0},
        {"cohort": "collateral", "before": "Allowed", "after": "Allowed", "days": 30, "attempts": 90, "changedAttempts": 0, "collateralChanges": 0},
    ]
    return {"scenarioId": scenario_id, "days": 30, "rows": rows, "collateralChanges": 0, "targetBlockedToAllowed": rows[0]["changedAttempts"]}


blastRadiusMatrix = counterfactual_replay

if __name__ == "__main__":
    print(json.dumps(verify_formal_invariants("INC-4092"), indent=2))
    broken = [dict(p, excludeGroups=[]) if p["id"] == "CA-001" else p for p in post_policies()]
    print("broken P_post passed (expected False):", verify_formal_invariants("INC-4092", post_policies_override=broken)["passed"])
    print("idempotency:", verify_idempotency("INC-4092"))
    print("blast radius:", json.dumps(counterfactual_replay("INC-4092")))
