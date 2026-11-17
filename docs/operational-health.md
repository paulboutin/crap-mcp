# Operational health

Operational health measures a **named workload on a declared source, deployment and configuration**. It adds three independent axes, each **0–100, higher is better**: Scalability, Performance and Reliability. Function CRAP, session health, security and accessibility scores are unchanged. There is no overall average.

This first version imports aggregates from a separately run harness. It never starts a load test, fault injection, cloud operation or production measurement when asked for a score. Source rules identify review candidates and verification recipes; they cannot establish runtime capacity, latency or reliability.

## Start a review

Use `$crap-operational-review` in Codex, `/crap-operational-review` in Claude Code, or ask OpenCode to use the skill. The machine installer includes this skill automatically.

1. Register the current checkout. Read its settings and `get_operational_scorecard` with `format:"data"`.
2. Define a version 1 policy in **Settings → Operational health**, or set `settings.operational` through `update_project_settings` with the current settings revision and a rationale. Blank/null disables the family. Other project settings are preserved. Team manifest includes this policy when shared; it does not export operational evidence.
3. Run a separately authorized harness. Import its aggregate object with `import_operational_evidence({project,evidence})`. The import returns a snapshot ID. Keep it as the baseline.
4. Read `get_operational_scorecard({project,snapshot,format:"markdown"})` and display its tables in chat. The project dashboard shows the latest imported workload. The import is scoped to that checkout, including when two checkouts share a Git repository.
5. After a change and fresh measurement, import again and call `review_operational_changes({project,before,after,format:"markdown"})`.

The [fictional catalog-read policy](examples/operational-policy.json) is a syntax example, **not a validated standard or a claim about this server's performance**. Review its thresholds, sample counts and workload assumptions before using it. The test fixtures fabricate aggregate inputs to verify the scorer; they are not performance benchmarks.

## Policy version 1

`src/operational-schema.ts` defines the runtime-validated contract. Unknown fields, unknown schema versions, nonfinite/negative measurements, malformed hashes, duplicate metric IDs, invalid counts and invalid distributions are rejected. Policy edits use the existing project settings revision check and change history. The policy hash includes the full parsed policy.

| Field | Meaning |
| --- | --- |
| `version` | Exactly `1` |
| `profile`, `workload` | Names for the policy and workload |
| `sourceRules` | Optional `per-call-client` and `promise-fanout`; default empty |
| `maxAgeSeconds`, `minDurationSeconds` | Freshness and minimum collection window |
| `confidence` | One-sided rate confidence, from 0.90 through 0.9999 |
| `axes` | Separate `scalability`, `performance`, `reliability` metric arrays; empty means unconfigured |
| Each metric | `id`, `label`, `weight`, `unit`, `direction`, `target`, `failureThreshold`, `mandatory`, `minSamples`, `statistic` |

Each configured axis needs at least one mandatory SLO and weights summing to 1. Units are `ms`, `s`, `ratio`, `count`, `bytes`, `usd/operation`. No implicit unit conversion occurs. Direction is `lower` or `higher`; statistic is `scalar`, `p95`, `p99` or `bad-rate-upper`. Targets and failure thresholds must be strictly ordered in the chosen direction. Equal thresholds are rejected, avoiding division by zero. Bad-event rates require lower-is-better ratios bounded by 0 and 1.

For lower-is-better metrics, quality is `clamp((failureThreshold-observed)/(failureThreshold-target),0,1)`. For higher-is-better metrics it is `clamp((observed-failureThreshold)/(target-failureThreshold),0,1)`. An axis's weighted score is `100 * sum(weight * quality)`.

With missing, stale, insufficient or incompatible evidence, a metric's quality is null. We do not reweight the remaining metrics. The lower bound is measured contribution; the upper bound adds the missing weight. **These bounds are not statistical confidence intervals, and the lower endpoint is not an estimate that missing work failed.** A complete scalar score is published only when every configured metric is eligible. This conservative first slice includes optional metrics in completeness; mandatory flags independently control SLO qualification.

Qualification is separate from the number: `unmeasured`, `measured-below-target`, `target-qualified`, or `blocked`. Failed global SLO/integrity gates block every axis. Confirmed accepted-data loss, duplicate external effects or privacy/reset bypass in a fault outcome also block qualification, even if the weighted score is 100. Missing gates remain unmeasured. Reliability requires fault evidence as well as eligible metrics. A gate is an assertion from the importing harness; importing does not independently attest to a deployed system.

## Evidence version 1

Evidence is passed as an object, not an executable command, file path or URL. No artifacts are fetched automatically. Hash fields are lowercase SHA-256 hex; `sourceCommit` is the exact local Git commit object ID (40 or 64 characters). The source commit must exist in the registered repository. Obtain `repository` and `policyHash` from the data scorecard, not by guessing them. Remote repository identity is hashed from the configured origin URL with its trailing `.git` removed; URL aliases are intentionally not treated as identical. Without origin, identity is local to the shared Git store. Copies on other machines should configure the same origin.

Required provenance: `repository`, `sourceCommit`, `imageHash`, `configHash`, `policyHash`, `workload`, `workloadHash`, `datasetHash`, `harnessVersion`, `environment`, `deployment`, `mode`, `resources`, `model` (nullable), `corpusHash` (nullable), `artifactHash`, and `privacy:"content-free-aggregates"`. Resources are `{name,value,unit}` entries describing host/hardware allocation. Mode is `synthetic`, `local`, `staging` or `production`; modes never compare implicitly.

Required collection fields: UTC `startedAt`/`endedAt`, matching positive `durationSeconds`, `status` (`completed`, `failed`, `incomplete`), `telemetryComplete`, and `coordinatedOmissionCorrected`. Failed/incomplete runs remain importable records, but supply no eligible scores. Future timestamps are rejected on import. Aging is reevaluated at every report read.

`attempts` has `offered`, `accepted`, `completed`, `errors`, `cancelled`, `incomplete`. The last four are disjoint outcomes summing to offered initial attempts; accepted cannot exceed offered, and completed cannot exceed accepted. Attempts still in flight are incomplete. Retry attempts must not inflate initial-attempt counts. `cancelled` is reserved for expected user cancellations under the versioned workload; system timeouts are errors/incomplete. This first contract supports a single outcome population per run. Import different journeys as separate workloads; do not combine incompatible populations.

Each `metrics` entry has `id`, `unit`, `population` and `observation`:

```json
{"id":"latency","unit":"ms","population":"all-attempts","observation":{"kind":"histogram","samples":100,"bins":[{"upper":100,"count":95},{"upper":1000,"count":5}]}}
```

Histogram bins are disjoint, ordered upper bounds; counts sum to samples. Percentiles use the upper bound of the bin containing the nearest-rank sample, a conservative approximation. Retain bins when combining compatible observations externally; never average p95/p99 values. This server does not merge runs. The all-attempt sample count must equal offered minus legitimate cancellations. Include elapsed time to failure/timeout/incomplete observation in timing distributions; a latency score alone never qualifies a journey whose SLO gate failed.

Other observations are `{kind:"scalar",value,samples}` and `{kind:"bad-rate",bad,samples,independentTrials:true}`. `bad-rate-upper` computes `min(1, bad/samples + sqrt(log(1/(1-confidence))/(2*samples)))`, a one-sided Hoeffding bound under independent Bernoulli trials. It is deliberately conservative. Zero failures in ten trials is not 99.9% reliability evidence. Correlated outage windows do not satisfy the independent-trials assumption; use a suitable externally reviewed protocol before importing. This is not a causal estimate or a guarantee of future reliability.

Populations are `all-attempts`, `successful-attempts`, `active-windows` and `fault-trials`. Successful-only observations are retained but ineligible. All-attempt bad events must include every error and incomplete attempt. Reliability accepts confidence-bounded rates or explicit fault-trial metrics, not a bare success ratio. Active-window and fault sample definitions belong in the versioned harness/workload; the importer cannot verify a producer's truthfulness.

`gates` requires `slo`, `accepted-data`, `external-effects`, `privacy-reset`, each `passed`, `failed` or `unmeasured`. `faults` records distinct named cases with `status`, nullable `recoverySeconds`, `lostAccepted`, `duplicateEffects`, and `privacyBypass`. Include the tested RTO/RPO and assertion protocol in the workload definition and artifact identified by hashes. `queues` records `{name,value,unit}` aggregates. `costBasis` is nullable unless a `usd/operation` metric is used; document infrastructure, inference, currency/window and successful equivalent-operation denominator. Do not place logs, audio, transcripts, identifiers or credentials in labels or artifacts intended for sharing.

## Comparisons and integration

Comparison requires identical repository, policy, workload/data/harness, environment, collection mode, resources, model/corpus, duration, offered demand, metric populations, fault-case set and cost basis. Configuration changes are rejected unless `allowConfigChange:true` explicitly acknowledges the experiment. Source/image/deployment/config differences are listed. An ineligible score has no numeric delta. Compatible contracts do not establish causation: repeat noisy measurements and inspect distributions.

Snapshots retain the exact parsed policy and evidence and are content-addressed in the checkout's Git-local store. Reimporting identical content is idempotent; tampered snapshots are rejected. Evidence is not copied to another checkout just because its source is related. Current-policy mismatches invalidate current scoring rather than silently rescaling an older observation. The report labels whether the observed source is included in the configured integration branch. **Ancestry is context, not evidence that a later merged image behaves identically**: rerun the workload against its exact integrated source/configuration.

## Source risk scope and remaining calibration

`scan_operational_risks` offers two opt-in AST checks for JS/TS: a direct named `Client` import from `pg` constructed inside a function, and direct `Promise.all(items.map(...))`. Findings include stable IDs, locations, scope, medium confidence and verification recipes. Already bounded inputs and one-time initialization can be legitimate. Unsupported files and omissions remain explicit. No regex match is treated as proof of a runtime failure. Infrastructure rules for shared quotas, history scans, shutdown, deadlines and queue budgets require more semantic context and are not implemented in this slice.

Workload-specific profiles can define capacity/headroom, efficiency, burst recovery and cost metrics, or startup, confirmation, acceptance, retrieval and active-loop timings. Proposed weighting families such as 40/20/25/15 for scalability or 40/25/25/10 for reliability are design choices requiring calibration. They are not built-in empirical standards. Choose paired p95/p99 weights explicitly. The example's scalar capacity ratio requires an independently measured sustained workload with its SLO gate passing; a configured limit is not sustainable capacity.

Production adapters, harness execution, histogram merging, confidence methods beyond the conservative bound, richer infrastructure analysis, and automatic operational CI gates are future extensions. The existing project checker and CRAP CI gate are unchanged by enabling an operational policy. This slice adds validated evidence, qualification, comparison and report surfaces that future collectors can use.
