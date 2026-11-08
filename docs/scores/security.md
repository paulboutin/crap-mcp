# Application security

[Security review](../skills/security-review.md) runs enabled source checks on supported JavaScript, TypeScript, JSX, TSX and Swift code. The score starts at **100**, subtracts **25 for each high** and **10 for each medium** match, and stops at zero. The weights belong to this project. The rule catalog uses [OWASP Top 10:2025 categories](https://owasp.org/Top10/2025/).

| Match | Mapping | Penalty |
| --- | --- | ---: |
| Direct eval call | A05 Injection | 25 |
| Interpolated SQL passed to a query or execute method | A05 Injection | 25 |
| Disabled TLS certificate verification | A07 Authentication Failures | 25 |
| MD5 or SHA-1 digest in a recognized call | A04 Cryptographic Failures | 10 |
| Swift certificate trust exception request | A07 Authentication Failures | 25 |

For example, one direct eval call and one weak digest yield **65/100** in a complete scan. Inspect what reaches the eval argument and what the digest protects. The source match identifies a review candidate. Exploitability depends on the inputs and runtime use.

## Read the denominator and scope

The report shows assessed files, skipped files, enabled rules and each matched occurrence. An incomplete scan or a scan with no assessable files or enabled rules is unrated. A score of 100 means the enabled patterns produced no matches in assessed source. Access control, transitive dependencies and deployed settings require separate evidence.

In **Project settings → Application security**, select rules and optionally set a minimum. A blank minimum records the score for review. A measured score below a configured minimum fails the project check.
