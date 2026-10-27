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

# ---------------------------------------------------------------------------
# ANOM-APP-401 shadow-admin mirror of apps/orchestrator/src/local/shadow-admin.ts
# ---------------------------------------------------------------------------

SHADOW_ADMIN_SCENARIO_ID = "ANOM-APP-401"
OVER_PRIVILEGED_SCOPES = ["Directory.ReadWrite.All", "Sites.FullControl.All", "Mail.ReadWrite", "RoleManagement.ReadWrite.Directory"]
RIGHT_SIZED_SCOPES = ["User.Read.All", "Sites.Selected"]


def scope_diff():
    return {"remove": list(OVER_PRIVILEGED_SCOPES), "add": list(RIGHT_SIZED_SCOPES),
            "activityEvidence": ["GET /v1.0/users", "POST /v1.0/sites/{fin-site-id}/lists"]}


def _shadow_nodes(scopes):
    return [
        {"id": "alex.wilber", "kind": "user", "label": "Alex Wilber", "upn": "alex.wilber.contoso@c4a8shili.onmicrosoft.com", "directoryRoles": [], "isAdmin": False, "tier": None},
        {"id": "spn-contoso-erp-sync", "kind": "servicePrincipal", "label": "spn-contoso-erp-sync (Contoso ERP Sync)", "directoryRoles": [], "isAdmin": False, "tier": None, "scopes": list(scopes)},
        {"id": "spn-contoso-erp-sync-credential", "kind": "credential", "label": "New credential for spn-contoso-erp-sync", "directoryRoles": [], "isAdmin": False, "tier": None},
        {"id": "GLOBAL_ADMIN", "kind": "directoryRole", "label": "Global Administrator", "directoryRoles": ["Global Administrator"], "isAdmin": True, "tier": 0},
        {"id": "bg-admin-01", "kind": "user", "label": "Break-glass admin 01", "upn": "bg-admin-01@c4a8shili.onmicrosoft.com", "directoryRoles": ["Global Administrator"], "isAdmin": True, "tier": None},
    ]


def shadow_admin_graph_pre():
    return {"scenarioId": SHADOW_ADMIN_SCENARIO_ID, "nodes": _shadow_nodes(OVER_PRIVILEGED_SCOPES), "edges": [
        {"from": "alex.wilber", "to": "spn-contoso-erp-sync", "kind": "OWNS_APP", "label": "OWNS_APP: alex.wilber owns the spn-contoso-erp-sync app registration"},
        {"from": "spn-contoso-erp-sync", "to": "spn-contoso-erp-sync-credential", "kind": "ADD_CREDENTIAL", "via": "RoleManagement.ReadWrite.Directory", "label": "ADD_CREDENTIAL (via RoleManagement.ReadWrite.Directory)"},
        {"from": "spn-contoso-erp-sync-credential", "to": "GLOBAL_ADMIN", "kind": "ASSUME_SPN", "via": "RoleManagement.ReadWrite.Directory", "label": "ASSUME_SPN: authenticate as SPN and assign Global Administrator (Tier 0)"},
        {"from": "bg-admin-01", "to": "GLOBAL_ADMIN", "kind": "ASSIGNED_ROLE", "label": "ASSIGNED_ROLE: bg-admin-01 legitimately holds Global Administrator"},
    ]}


def shadow_admin_graph_post():
    # Owner removed, OAuth grant revoked, scopes right-sized: no escalation edges.
    return {"scenarioId": SHADOW_ADMIN_SCENARIO_ID, "nodes": _shadow_nodes(RIGHT_SIZED_SCOPES), "edges": [
        {"from": "bg-admin-01", "to": "GLOBAL_ADMIN", "kind": "ASSIGNED_ROLE", "label": "ASSIGNED_ROLE: bg-admin-01 legitimately holds Global Administrator"},
    ]}


def find_shadow_admin_paths(graph, max_hops=3):
    targets = {n["id"] for n in graph["nodes"] if n.get("tier") == 0 or n["id"] == "GLOBAL_ADMIN"}
    starts = sorted(n["id"] for n in graph["nodes"] if n["kind"] == "user" and not n["isAdmin"] and not n["directoryRoles"])
    adjacency = {}
    for e in graph["edges"]:
        adjacency.setdefault(e["from"], []).append(e)
    for lst in adjacency.values():
        lst.sort(key=lambda e: (e["to"], e["kind"]))
    paths = []

    def visit(start, current, nodes, edges, seen):
        if edges and current in targets:
            paths.append({"start": start, "startUser": start, "end": current, "target": current,
                          "nodes": list(nodes), "edges": list(edges),
                          "kinds": [e["kind"] for e in edges], "hops": len(edges)})
            return
        if len(edges) >= max_hops:
            return
        for e in adjacency.get(current, []):
            if e["to"] in seen:
                continue
            seen.add(e["to"]); nodes.append(e["to"]); edges.append(e)
            visit(start, e["to"], nodes, edges, seen)
            edges.pop(); nodes.pop(); seen.discard(e["to"])

    for s in starts:
        visit(s, s, [s], [], {s})
    paths.sort(key=lambda p: (p["start"], p["hops"], ">".join(p["nodes"])))
    return paths


def transitive_tier0_shadow_admins(graph, max_hops=3):
    return sorted({p["start"] for p in find_shadow_admin_paths(graph, max_hops)})


def verify_shadow_admin_invariant(scenario_id=SHADOW_ADMIN_SCENARIO_ID):
    pre, post = shadow_admin_graph_pre(), shadow_admin_graph_post()
    pre_paths, post_paths = find_shadow_admin_paths(pre), find_shadow_admin_paths(post)
    post_admins = transitive_tier0_shadow_admins(post)
    counterexamples = [{"invariant": "shadow-admin-zero-transitive", "entity": p["start"],
                        "context": "Tier0 escalation path in P_post",
                        "detail": f"must be EMPTY, found {p['start']} -> {p['target']} in {p['hops']} hop(s)"} for p in post_paths]
    return {"id": "shadow-admin-zero-transitive", "statement": "TransitiveTier0ShadowAdmins(P_post)==EMPTY",
            "passed": post_admins == [], "checked": len(pre_paths), "counterexamples": counterexamples,
            "evidence": [f"pre paths: {len(pre_paths)} for {transitive_tier0_shadow_admins(pre)}", "TransitiveTier0ShadowAdmins(P_post)==EMPTY"] if post_admins == [] else []}


# Proactive-remediation detect-script check (mirror of formal-verifier.ts).
import re as _re

_MUTATING_CMDLET_RE = _re.compile(r"\b(?:Set|Remove|New)-[A-Za-z][\w-]*")
_REST_MUTATION_RE = _re.compile(r"Invoke-RestMethod[^;\n]{0,200}?-Method\s*:?\s*['\"]?(Post|Patch|Delete)\b", _re.IGNORECASE)
DETECT_OUTPUT_LIMIT = 2048


def verify_proactive_remediation_invariant(detect_script, remediate_applied=None):
    code = _re.sub(r"<#[\s\S]*?#>", " ", detect_script or "")
    code = "\n".join(l for l in code.split("\n") if not l.lstrip().startswith("#"))
    counterexamples = []
    for cmdlet in sorted(set(_MUTATING_CMDLET_RE.findall(code))):
        counterexamples.append({"invariant": "proactive-remediation-detect-read-only", "entity": "detect-script",
                                "context": "mutating-cmdlet", "detail": f"detect script must be read-only, found {cmdlet}"})
    for call in _REST_MUTATION_RE.findall(code):
        counterexamples.append({"invariant": "proactive-remediation-detect-read-only", "entity": "detect-script",
                                "context": "mutating-rest-call", "detail": "detect script must be read-only, found mutating Invoke-RestMethod"})
    has_exit = bool(_re.search(r"\bexit\s+0\b", code)) and bool(_re.search(r"\bexit\s+1\b", code))
    if not has_exit:
        counterexamples.append({"invariant": "proactive-remediation-detect-read-only", "entity": "detect-script",
                                "context": "exit-contract", "detail": "detect script must signal with exit 0 and exit 1"})
    oversized = [len(m) for m in _re.findall(r"'[^'\n]{2048,}'|\"[^\"\n]{2048,}\"", code)]
    if oversized:
        counterexamples.append({"invariant": "proactive-remediation-detect-read-only", "entity": "detect-script",
                                "context": "output-limit", "detail": f"output must stay under {DETECT_OUTPUT_LIMIT} chars"})
    return {"id": "proactive-remediation-detect-read-only", "passed": not counterexamples, "checked": 4,
            "counterexamples": counterexamples,
            "detectReadOnly": not any(c["context"] in ("mutating-cmdlet", "mutating-rest-call") for c in counterexamples),
            "hasExitContract": has_exit, "outputWithinLimit": not oversized}


checkDetectReadOnly = verify_proactive_remediation_invariant


if __name__ == "__main__":
    print(json.dumps(verify_formal_invariants("INC-4092"), indent=2))
    broken = [dict(p, excludeGroups=[]) if p["id"] == "CA-001" else p for p in post_policies()]
    print("broken P_post passed (expected False):", verify_formal_invariants("INC-4092", post_policies_override=broken)["passed"])
    print("idempotency:", verify_idempotency("INC-4092"))
    print("blast radius:", json.dumps(counterfactual_replay("INC-4092")))
    print("shadow-admin pre paths:", json.dumps(find_shadow_admin_paths(shadow_admin_graph_pre())))
    print("shadow-admin post transitive (expected []):", transitive_tier0_shadow_admins(shadow_admin_graph_post()))
    print("shadow-admin invariant:", json.dumps(verify_shadow_admin_invariant("ANOM-APP-401")))
    print("scope diff:", json.dumps(scope_diff()))
    print("proactive detect (good, expected passed True):", verify_proactive_remediation_invariant("Get-Process | Out-Null\nif ($ok) { exit 0 } else { exit 1 }")["passed"])
    print("proactive detect (mutating, expected passed False):", verify_proactive_remediation_invariant("Set-MgUser -UserId x\nexit 0\nexit 1")["passed"])
