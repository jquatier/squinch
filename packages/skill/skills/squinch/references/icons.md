# Icons, pack by pack

Open this when you need an icon id outside the AWS basics in `SKILL.md`:
the ids and aliases each pack ships, the Google Cloud category rule, the
Kubernetes short names, the `sys/` rows by theme, and the recipe for a vendor
with no pack. Searching is still the first move — `squinch icons search "a, b, c"`
batches every unknown in one call — and this file says what the search will
find and which id to prefer when several match.

## Contents

- [AWS](#aws) — the ids you'll use constantly, and the confusable pairs
- [Azure](#azure) — portal names, and the short forms everybody abbreviates
- [Google Cloud](#google-cloud) — nineteen unique marks; everything else draws its category glyph
- [Kubernetes](#kubernetes) — kubectl short names for what runs inside a cluster
- [Logos — products and open source](#logos--products-and-open-source) — brand marks for the non-cloud half of a stack
- [sys — the generic set](#sys--the-generic-set) — Lucide icons for what no vendor draws, by theme
- [Platforms with no icon pack](#platforms-with-no-icon-pack) — Databricks, Snowflake, dbt, Confluent: `sys/*` plus a `badge:`

## AWS

When the request names a **specific product**, search for it — don't write the id
from memory. `check` only tells you an id exists, never that it's the one the
reader asked for, so a plausible-but-wrong mark passes silently and ships. The
confusable pairs are the ones to watch: CloudFront (`aws/cloudfront`, a CDN) is
not Cloudflare (`logos/cloudflare`, a different company); `aws/aurora` is not
`aws/rds`. One `squinch icons search cloudfront` settles it.

`lambda` · `dynamodb` · `s3` · `sqs` · `sns` · `api-gateway` · `opensearch` ·
`aurora` · `rds` · `elasticache` · `cloudfront` · `eventbridge` · `kinesis` ·
`step-functions` · `ecs` · `eks` · `fargate` · `ecr` · `athena` · `glue` ·
`redshift` · `sagemaker` · `bedrock` · `rekognition` · `cognito` ·
`secrets-manager` · `route-53` · `waf` · `elastic-load-balancing` (alias `elb`) ·
`batch` · `efs` · `app-runner`

Short aliases exist for the famous ones (`s3`, `sqs`, `sns`, `eks`, `ecs`, `ecr`,
`elb`, `glacier`, `opensearch`).

## Azure

**Azure** has its own pack (636 icons). Short forms exist for the ones everybody
abbreviates: `azure/aks` · `azure/vm` · `azure/vnet` · `azure/cosmos` ·
`azure/functions` · `azure/sql` · `azure/blob` · `azure/service-bus` ·
`azure/event-hub` · `azure/key-vault` · `azure/front-door` · `azure/app-gateway` ·
`azure/load-balancer` · `azure/aci` · `azure/acr` · `azure/api-management` ·
`azure/log-analytics` · `azure/redis`. Canonical ids read like the portal —
`azure/app-services`, `azure/storage-accounts`, `azure/monitor`,
`azure/application-insights`; `squinch icons search --pack azure <term>` scopes
the search. Pick one cloud's pack and stay with it — don't draw the same
concept as `aws/…` in one box and `azure/…` in the next. Combining a cloud pack
with `logos` is a different thing and completely normal: it's how you draw a
hybrid estate, with `logos/postgres` on the on-prem side and `azure/sql` in the
cloud.

## Google Cloud

**Google Cloud** has its own pack (45 icons), and it works differently from
the other two clouds because Google's own icon system does: nineteen core
products carry a unique four-colour mark, and *every other product draws as
its category's glyph*. The unique marks: `gcp/cloud-run` (`run`) · `gcp/gke` ·
`gcp/compute-engine` (`gce`, `vm`) · `gcp/cloud-storage` (`gcs`, `bucket`) ·
`gcp/cloud-sql` (`sql`) · `gcp/spanner` · `gcp/alloydb` · `gcp/bigquery` (`bq`)
· `gcp/vertex-ai` (`vertex`) · `gcp/looker` · `gcp/apigee` · `gcp/anthos` ·
`gcp/distributed-cloud` (`gdc`) · `gcp/hyperdisk` (`persistent-disk`) ·
`gcp/ai-hypercomputer` · `gcp/security-command-center` (`scc`) ·
`gcp/security-operations` (`secops`) · `gcp/threat-intelligence` ·
`gcp/mandiant`. Everything else resolves by the name you know it by and draws
the category glyph: `gcp/pubsub`, `gcp/dataflow` and `gcp/dataproc` all draw
the Data Analytics mark; `gcp/cloud-functions` (`functions`) and
`gcp/app-engine` the Serverless one; `gcp/firestore`, `gcp/bigtable` and
`gcp/memorystore` the Databases one; `gcp/load-balancer` (`lb`), `gcp/cloud-cdn`,
`gcp/cloud-armor` and `gcp/cloud-nat` the Networking one; `gcp/iam`, `gcp/kms`
and `gcp/secret-manager` the Security one; `gcp/cloud-build` and
`gcp/artifact-registry` the DevOps one; `gcp/cloud-logging` and
`gcp/cloud-monitoring` the Observability one. That is how Google draws them
now, so it is not a shortfall to work around — **put the product name in the
label** and let the icon say the category; don't borrow a look-alike from
`aws/` or `azure/`. A VPC is a boundary: `zone net "prod-vpc" network {
contains …, icon: gcp/vpc }`. The same one-cloud rule applies, and composing
with `logos` is normal. Use `gcp/*` when the diagram is about what runs
*inside* Google Cloud; use `logos/googlecloud` when Google Cloud is one box in
a wider estate. `squinch icons search --pack gcp <term>` scopes the search;
the bare word `gcp` lists the whole pack.

## Kubernetes

**Kubernetes internals** come from the `k8s` pack (39 official community
icons — the blue heptagons from the k8s docs). Canonical ids are kubectl's
short names, and the long names alias to them, so both spellings check clean:
`k8s/pod` · `k8s/deploy` (`deployment`) · `k8s/svc` (`service`) · `k8s/sts`
(`statefulset`) · `k8s/ds` (`daemonset`) · `k8s/rs` (`replicaset`) · `k8s/cm`
(`configmap`) · `k8s/secret` · `k8s/ing` (`ingress`) · `k8s/ns` (`namespace`) ·
`k8s/sa` (`serviceaccount`) · `k8s/pv` · `k8s/pvc` · `k8s/sc` · `k8s/netpol` ·
`k8s/hpa` · `k8s/job` · `k8s/cronjob` · `k8s/crd` · `k8s/node` · `k8s/etcd` ·
`k8s/control-plane` · `k8s/api` (`apiserver`) · `k8s/sched` (`scheduler`) ·
`k8s/kubelet` · `k8s/k-proxy` (`kubeproxy`).
Use `k8s/*` when the diagram is about what runs *inside* a cluster; use
`logos/kubernetes` when the cluster is one box in a wider estate. A namespace
is a boundary, not a workload — prefer `zone team-a "team-a" custom { contains
…, icon: k8s/ns }` over a `k8s/ns` node. Composing with a cloud pack is normal:
`azure/aks` or `aws/eks` as the managed control plane, `k8s/*` for what it runs.

## Logos — products and open source

**Non-AWS things** come from the `logos` pack (147 product marks, plated in
their brand colour): `logos/postgres` · `logos/mysql` · `logos/mongodb` ·
`logos/redis` · `logos/kafka` · `logos/rabbitmq` · `logos/elasticsearch` ·
`logos/kubernetes` (`k8s`) · `logos/docker` · `logos/terraform` ·
`logos/nginx` · `logos/github` · `logos/gitlab` · `logos/grafana` ·
`logos/prometheus` · `logos/datadog` · `logos/sentry` · `logos/stripe` ·
`logos/snowflake` · `logos/cloudflare` · `logos/vercel` · `logos/nextdotjs` ·
`logos/react` · `logos/python` · `logos/nodedotjs` (`node`) · `logos/go` ·
`logos/rust` · `logos/graphql`.
Some brands (Slack, Twilio, Salesforce, Heroku, gRPC…) have no icon upstream —
they were withdrawn on trademark request. Use `box` for those.

## sys — the generic set

`sys/*` is the generic set — 195 Lucide icons for anything no vendor draws, and
it needs no `pack` statement. Use it for on-prem and physical things, and as the
last resort when nothing else fits. Ids are Lucide's own names:

- **compute / app** — `server`, `container`, `cpu`, `code`, `app-window`,
  `hexagon`, `terminal`, `cog`, `webhook`, `workflow`, `route`
- **hardware** — `laptop`, `monitor`, `smartphone`, `hard-drive`, `printer`
- **network** — `network`, `router`, `wifi`, `radio-tower`, `globe`, `share-2`
- **security** — `lock`, `lock-keyhole`, `key-round`, `shield`, `shield-check`
- **data** — `database`, `folder`, `search`, `archive`, `table`, `file`
- **places** — `factory`, `warehouse`, `building-2`, `house`, `earth`
- **process / observability** — `clock`, `timer`, `repeat`, `activity`, `gauge`,
  `chart-line`, `siren`, `bug`
- **commerce** — `shopping-cart`, `shopping-bag`, `credit-card`, `wallet`,
  `receipt-text`, `banknote`, `coins`, `badge-percent`, `ticket`, `truck`,
  `package-check`, `barcode`, `calculator`, `gift`, `heart`, `headset`
- **shapes, when nothing fits** — `box`, `circle`, `square`, `triangle`,
  `diamond`, `hexagon`, `star`

Short aliases exist for words you would type instead: `gear`→`cog`,
`cube`→`box`, `db`→`database`, `rack`/`vm`/`host`→`server`, `disk`→`hard-drive`,
`firewall`→`shield`, `vault`→`lock-keyhole`, `cron`→`clock`, `lb`→`share-2`,
`cart`→`shopping-cart`, `checkout`→`shopping-bag`, `payment`→`credit-card`,
`order`/`invoice`→`receipt-text`, `shipping`→`truck`, `ads`→`megaphone`.

## Platforms with no icon pack

Some vendors publish no icons anyone may redistribute, so no pack exists and none
ever will — Databricks, Snowflake, dbt and Confluent are the ones that come up.
Don't reach for a lookalike from another vendor and don't invent an id. Draw the
*concept* from `sys/*` and mark it with the vendor's mark from `logos/*`:

```squinch
wh = sys/database "SQL warehouse" { badge: logos/databricks, subtitle: "Databricks SQL" }
```

The `subtitle:` is optional; it names the product where the mark alone only
names the vendor.

Databricks, worked out — every base below is a real `sys/` id or alias:

| component | write |
| --- | --- |
| Delta table | `sys/table … { badge: logos/databricks }` |
| Unity Catalog | `sys/catalog` |
| SQL warehouse | `sys/database` |
| Vector search | `sys/waypoints` |
| Model serving | `sys/model` |
| MLflow experiment | `sys/experiment` |
| Notebook | `sys/notebook` |
| Workflows job | `sys/workflow` |
| Structured streaming | `sys/stream` |

The same recipe covers any vendor whose mark is in the logos pack —
`logos/snowflake` is there, dbt and Confluent are not. Search before writing a
badge; if there's no mark, skip the badge and let the label carry the vendor.
Badge only what the platform actually owns: a Kafka or S3 node keeps its own
icon, and that contrast is what makes the platform boundary readable.
