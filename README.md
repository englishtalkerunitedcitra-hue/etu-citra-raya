# etu-citra-raya
website ETU Citra Raya

## Ruang staf CS & Sales (proposed feature)

`/staff/` is separate from the public website and uses Supabase Auth + a shared PostgreSQL database with server-side access controls. It requires project configuration before it can be used. Public Free Trial booking remains anonymous and unchanged.

See [setup, security model, Sheet mapping, tests and deployment](docs/STAFF-SETUP.md). Do not put service-role keys in frontend configuration. Review the feature PR before merging or publishing production.
