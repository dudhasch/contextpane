/**
 * ANOM-APP-401 · Shadow-admin privilege graph (Place 1 companion).
 *
 * Deterministic, synchronous, no LLM / GPU / I/O (<100 ms). Models the
 * privilege-escalation path by which a user with ZERO directory roles
 * becomes a Tier 0 / Global Administrator shadow admin:
 *
 *   alex.wilber (0 directory roles)
 *     -OWNS_APP-> spn-contoso-erp-sync
 *     -ADD_CREDENTIAL (via RoleManagement.ReadWrite.Directory)->
 *       spn-contoso-erp-sync credential
 *     -ASSUME_SPN-> GLOBAL_ADMIN (Tier 0)
 *
 * Ownership of the app registration lets the owner add a credential;
 * authenticating as the service principal (ASSUME_SPN) yields its
 * RoleManagement.ReadWrite.Directory scope, which can assign the
 * Global Administrator (Tier 0) directory role.
 *
 * Written against plain string scenario ids (see SHADOW_ADMIN_SCENARIO_ID)
 * so this module compiles regardless of whether ANOM-APP-401 has landed
 * in @contextpane/catalog yet. It deliberately does NOT import the
 * catalog: the graph is its own model.
 */

export const SHADOW_ADMIN_SCENARIO_ID = "ANOM-APP-401";

export const SHADOW_ADMIN_USER = "alex.wilber";
export const SHADOW_ADMIN_USER_UPN = "alex.wilber.contoso@c4a8shili.onmicrosoft.com";
export const SHADOW_ADMIN_SPN = "spn-contoso-erp-sync";
export const SHADOW_ADMIN_CREDENTIAL = "spn-contoso-erp-sync-credential";
export const GLOBAL_ADMIN_NODE = "GLOBAL_ADMIN";
export const GLOBAL_ADMIN_LABEL = "Global Administrator";
/** Assumed-SPN session node label segment (the ASSUME_SPN step target role). */
export const TIER0_ROLE = GLOBAL_ADMIN_NODE;

export type PrivilegeNodeKind =
  | "user"
  | "servicePrincipal"
  | "credential"
  | "directoryRole"
  | "assumedIdentity";

export type PrivilegeEdgeKind =
  | "OWNS_APP"
  | "ADD_CREDENTIAL"
  | "ASSUME_SPN"
  | "ASSIGNED_ROLE"
  | "HAS_SCOPE";

export interface PrivilegeNode {
  id: string;
  kind: PrivilegeNodeKind;
  label: string;
  /** User principal name / app id style identifier, when applicable. */
  upn?: string;
  /** Directory roles held directly (empty for the shadow-admin user). */
  directoryRoles: string[];
  /** True when the principal already holds a privileged/Tier 0 role. */
  isAdmin: boolean;
  /** 0 for Tier 0 targets (Global Administrator); null otherwise. */
  tier: 0 | null;
  /** OAuth / Graph scopes granted to a service principal. */
  scopes?: string[];
}

export interface PrivilegeEdge {
  from: string;
  to: string;
  kind: PrivilegeEdgeKind;
  /** Scope / mechanism that enables this step, when applicable. */
  via?: string;
  label: string;
}

export interface PrivilegeGraph {
  scenarioId: string;
  nodes: PrivilegeNode[];
  edges: PrivilegeEdge[];
}

export interface ShadowAdminPath {
  /** Non-admin user the path starts from. */
  start: string;
  startUser: string;
  /** Tier 0 target node id (GLOBAL_ADMIN). */
  end: string;
  target: string;
  /** Node ids in order, start first, Tier 0 target last. */
  nodes: string[];
  /** Edges traversed, in order. */
  edges: PrivilegeEdge[];
  /** Edge kinds traversed, in order (e.g. OWNS_APP, ADD_CREDENTIAL, ASSUME_SPN). */
  kinds: PrivilegeEdgeKind[];
  hops: number;
}

export interface ScopeDiff {
  remove: string[];
  add: string[];
  activityEvidence: string[];
}

const OVER_PRIVILEGED_SCOPES: readonly string[] = [
  "Directory.ReadWrite.All",
  "Sites.FullControl.All",
  "Mail.ReadWrite",
  "RoleManagement.ReadWrite.Directory",
];

const RIGHT_SIZED_SCOPES: readonly string[] = ["User.Read.All", "Sites.Selected"];

/**
 * Least-privilege scope diff for spn-contoso-erp-sync, justified by its
 * observed Graph activity (activityEvidence): it only reads users and
 * writes to one finance site's lists, so the broad directory / sites /
 * mail / role-management scopes are removed.
 */
export function scopeDiff(): ScopeDiff {
  return {
    remove: [...OVER_PRIVILEGED_SCOPES],
    add: [...RIGHT_SIZED_SCOPES],
    activityEvidence: ["GET /v1.0/users", "POST /v1.0/sites/{fin-site-id}/lists"],
  };
}

function baseNodes(spnScopes: readonly string[]): PrivilegeNode[] {
  return [
    {
      id: SHADOW_ADMIN_USER,
      kind: "user",
      label: "Alex Wilber",
      upn: SHADOW_ADMIN_USER_UPN,
      directoryRoles: [],
      isAdmin: false,
      tier: null,
    },
    {
      id: SHADOW_ADMIN_SPN,
      kind: "servicePrincipal",
      label: "spn-contoso-erp-sync (Contoso ERP Sync)",
      directoryRoles: [],
      isAdmin: false,
      tier: null,
      scopes: [...spnScopes],
    },
    {
      id: SHADOW_ADMIN_CREDENTIAL,
      kind: "credential",
      label: "New credential for spn-contoso-erp-sync",
      directoryRoles: [],
      isAdmin: false,
      tier: null,
    },
    {
      id: GLOBAL_ADMIN_NODE,
      kind: "directoryRole",
      label: GLOBAL_ADMIN_LABEL,
      directoryRoles: [GLOBAL_ADMIN_LABEL],
      isAdmin: true,
      tier: 0,
    },
    {
      // Legitimate, already-privileged admin: NOT a shadow admin.
      id: "bg-admin-01",
      kind: "user",
      label: "Break-glass admin 01",
      upn: "bg-admin-01@c4a8shili.onmicrosoft.com",
      directoryRoles: [GLOBAL_ADMIN_LABEL],
      isAdmin: true,
      tier: null,
    },
  ];
}

/** Pre-remediation graph P_pre: owner + over-privileged grant present. */
export function shadowAdminGraphPre(): PrivilegeGraph {
  return {
    scenarioId: SHADOW_ADMIN_SCENARIO_ID,
    nodes: baseNodes(OVER_PRIVILEGED_SCOPES),
    edges: [
      {
        from: SHADOW_ADMIN_USER,
        to: SHADOW_ADMIN_SPN,
        kind: "OWNS_APP",
        label: "OWNS_APP: alex.wilber owns the spn-contoso-erp-sync app registration",
      },
      {
        from: SHADOW_ADMIN_SPN,
        to: SHADOW_ADMIN_CREDENTIAL,
        kind: "ADD_CREDENTIAL",
        via: "RoleManagement.ReadWrite.Directory",
        label:
          "ADD_CREDENTIAL (via RoleManagement.ReadWrite.Directory): owner adds a credential to spn-contoso-erp-sync",
      },
      {
        from: SHADOW_ADMIN_CREDENTIAL,
        to: GLOBAL_ADMIN_NODE,
        kind: "ASSUME_SPN",
        via: "RoleManagement.ReadWrite.Directory",
        label:
          "ASSUME_SPN: authenticate as spn-contoso-erp-sync and assign Global Administrator (Tier 0) via RoleManagement.ReadWrite.Directory",
      },
      {
        from: "bg-admin-01",
        to: GLOBAL_ADMIN_NODE,
        kind: "ASSIGNED_ROLE",
        label: "ASSIGNED_ROLE: bg-admin-01 legitimately holds Global Administrator",
      },
    ],
  };
}

/**
 * Post-remediation graph P_post: app owner removed, OAuth grant revoked
 * and scopes right-sized (see scopeDiff()). No escalation edges remain,
 * so the transitive Tier 0 shadow-admin set is EMPTY.
 */
export function shadowAdminGraphPost(): PrivilegeGraph {
  return {
    scenarioId: SHADOW_ADMIN_SCENARIO_ID,
    nodes: baseNodes(RIGHT_SIZED_SCOPES),
    edges: [
      {
        from: "bg-admin-01",
        to: GLOBAL_ADMIN_NODE,
        kind: "ASSIGNED_ROLE",
        label: "ASSIGNED_ROLE: bg-admin-01 legitimately holds Global Administrator",
      },
    ],
  };
}

function isTier0Target(node: PrivilegeNode): boolean {
  return node.tier === 0 || node.id === GLOBAL_ADMIN_NODE || node.label === GLOBAL_ADMIN_LABEL;
}

function isNonAdminUser(node: PrivilegeNode): boolean {
  return node.kind === "user" && !node.isAdmin && node.directoryRoles.length === 0;
}

/**
 * All simple paths (<= maxHops edges) from non-admin users to a Tier 0 /
 * Global Administrator node. Deterministic order: by start, then hops,
 * then node-id sequence.
 */
export function findShadowAdminPaths(graph: PrivilegeGraph, maxHops = 3): ShadowAdminPath[] {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const targets = new Set(graph.nodes.filter(isTier0Target).map((n) => n.id));
  const starts = graph.nodes.filter(isNonAdminUser).map((n) => n.id).sort();
  const adjacency = new Map<string, PrivilegeEdge[]>();
  for (const e of graph.edges) {
    const list = adjacency.get(e.from) ?? [];
    list.push(e);
    adjacency.set(e.from, list);
  }
  for (const list of adjacency.values()) list.sort((a, b) => a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind));

  const paths: ShadowAdminPath[] = [];
  const visit = (start: string, current: string, nodes: string[], edges: PrivilegeEdge[], seen: Set<string>) => {
    if (edges.length > 0 && targets.has(current)) {
      paths.push({
        start,
        startUser: start,
        end: current,
        target: current,
        nodes: [...nodes],
        edges: [...edges],
        kinds: edges.map((e) => e.kind),
        hops: edges.length,
      });
      return; // do not extend past a Tier 0 target
    }
    if (edges.length >= maxHops) return;
    for (const e of adjacency.get(current) ?? []) {
      if (seen.has(e.to)) continue;
      seen.add(e.to);
      nodes.push(e.to);
      edges.push(e);
      visit(start, e.to, nodes, edges, seen);
      edges.pop();
      nodes.pop();
      seen.delete(e.to);
    }
    void nodeById;
  };
  for (const start of starts) visit(start, start, [start], [], new Set([start]));
  paths.sort((a, b) => a.start.localeCompare(b.start) || a.hops - b.hops || a.nodes.join(">").localeCompare(b.nodes.join(">")));
  return paths;
}

/** Sorted unique non-admin users that can transitively reach Tier 0. */
export function transitiveTier0ShadowAdmins(graph: PrivilegeGraph, maxHops = 3): string[] {
  return [...new Set(findShadowAdminPaths(graph, maxHops).map((p) => p.start))].sort();
}
