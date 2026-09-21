# DNS and domain recovery

No DNS changes or Production queries were performed. The repository identifies domains, not the authoritative registrar/zone or current record values.

| Name | Known role | Recovery requirement |
|---|---|---|
| app.thebackyard.com.mx | Prepared canonical application origin / protected production target | Owner-approved HTTPS hosting target after all restore gates |
| beta.thebackyard.com.mx | Protected stable beta | Keep separate from new QA/restore; never repoint accidentally |
| thebackyard.com.mx | Known brand/site root | Confirm current site owner and hosting before changing |
| auth.thebackyard.com.mx | Verified sender domain used by Auth email | Preserve provider SPF/DKIM/return-path records as supplied by the email provider |

Public profile QR identity is independent of username; hostname ownership still matters. New provider URLs require matching Auth redirect allowlists and OAuth provider callbacks.

## Owner custody snapshot

Export the complete authoritative DNS zone (including record names, types, targets, TTLs and verification records), registrar/authoritative nameserver account access, renewal/billing owner, DNSSEC/DS settings if actually enabled, and email provider verification state. Put secrets/account-recovery codes in a password manager. No such export was available in this task.

## Cutover procedure — future explicit approval only

Verify restored Preview on HTTPS first. Obtain exact DNS targets from the **new hosting project's domain setup**, not old documentation. Review CNAME/A/ALIAS compatibility and certificate validation; do not invent an IP or a generic Vercel CNAME. Keep email TXT/MX/DKIM records intact. If changing nameservers or DNSSEC, follow registrar-specific staged instructions. Lower TTL only under a planned owner-approved cutover. Verify HTTPS, OAuth, QR links, email and caches before retiring old infrastructure.

DNS recovery status is BLOCKED_EXTERNAL until the authoritative zone and account ownership are in independent custody. No domain promotion is authorized by this backup task.
