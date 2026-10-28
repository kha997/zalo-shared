# Optional private monitoring configuration

These files configure an existing private Prometheus collector only. No collector image, service, host port, external endpoint or deployment is created. Join a reviewed collector to the application's internal Docker network, mount prometheus.yml and alerts.yml at /etc/prometheus/, and mount a private token file at /run/secrets/metrics_token containing the exact METRICS_TOKEN value. Keep token file readable only by collector UID; never commit its contents. Prometheus `bearer_token_file` implements bearer token file authentication. Restrict access to collector UI/API, which can expose target and operational metadata. Review collector version/image digest and notification destination before enabling.

| Signal | Present config | Limit |
| --- | --- | --- |
| Unknown jobs | zs_outbox_jobs{status="unknown"} > 0, immediate | Counts require successful authenticated scrape. |
| Metrics availability | up == 0 for 30 seconds | Detects failed /metrics scrape, including database failure/auth failure. This is not a dedicated /health/ready probe. |
| Pending age | Open instrument gap | Backend exports status counts only; no queue-age metric exists, so no inactive pretend rule is installed. Add verified metric before pending age >60 seconds for 5 minutes alert. |
| Readiness endpoint | Open collector gap | Probe /health/ready with a reviewed internal blackbox monitor before declaring readiness alert coverage. |
| Provider freshness | Open instrument gap | Provider status/lastEventAt API exists, no Prometheus freshness metric. Alert only when traffic expected; quiet account is not necessarily stale. |

No notifications are configured or sent. Validate config/rules with the chosen collector's promtool, then exercise unknown-job and failed-scrape conditions in the simulator before relying on alerts. Configure a reviewed notification receiver and on-call owner separately. Missing time series must not be interpreted as a healthy queue.

Rotate token by generating a new random value, atomically replacing private collector token file and external app configuration, restarting app, and verifying old bearer is rejected/new bearer accepted. Keep the collector alert for scrape failure active during rotation; suppress only with an explicit maintenance window. Revoke a leaked token immediately, assess collector/host access, and preserve redacted incident evidence.
