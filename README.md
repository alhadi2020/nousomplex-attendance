# Nousomplex Attendance Portal

A standalone attendance portal designed to be hosted on **GitHub Pages** and connected to **Supabase** for secure user accounts and data storage. It does not require custom Odoo code.

## What it includes

- Teacher sign-up and administrator activation of teacher accounts.
- Administrator-only teacher, class, and student registration.
- Teacher access limited by database policies to assigned classes and their students.
- Present, Absent, and Leave attendance marking.
- Administrator and teacher dashboards.
- Daily, monthly, and yearly reports (choose the relevant date range).
- Real Excel (`.xlsx`) export and browser Print / Save as PDF.

## Important security design

This portal is public as a website, but its data is not public. Supabase Authentication requires users to sign in, and `supabase/schema.sql` enables Row Level Security (RLS) to enforce administrator/teacher access in the database.

Never place a Supabase **service role** key in `config.js`. Only use the **anon/public** key.

## Go live in 20 minutes

### A. Create the database

1. Create a free project at [Supabase](https://supabase.com/dashboard).
2. In the project, open **SQL Editor** → **New query**.
3. Copy everything from `supabase/schema.sql`, paste it, and click **Run**.
4. Open **Project Settings** → **API**. Copy the **Project URL** and **anon/public key**.
5. In `config.js`, replace the two `PASTE_...` values with those values.

### B. Publish on GitHub Pages

1. Create a new **private or public** GitHub repository named `nousomplex-attendance`.
2. Upload all files in this folder to the repository root; `index.html` must be at the root.
3. Commit the changes.
4. In the repository, open **Settings** → **Pages**.
5. Under **Build and deployment**, choose **Deploy from a branch**, then select `main` and `/ (root)`. Click **Save**.
6. GitHub shows your portal address, usually:

   `https://YOUR-GITHUB-USERNAME.github.io/nousomplex-attendance/`

### C. Create the first administrator

1. Open the published portal URL.
2. Enter your email and password, then click **New teacher? Create an account**.
3. Confirm the signup email from Supabase, then return to Supabase **SQL Editor**.
4. Run this query, replacing the email:

```sql
update public.profiles
set role = 'admin', full_name = 'Your Name'
where email = 'YOUR-EMAIL@example.com';
```

5. Sign in again. You now have administrator access.

### D. Add teachers and classes

1. Each teacher signs up through the portal and confirms their email.
2. As the administrator, open **Teachers**, select their signed-up account, and activate the profile.
3. Open **Classes**, create the class, and assign the teacher.
4. Open **Students** and register learners in their class.

## Put it on `attendance.nousomplex.com`

Using a separate subdomain is the cleanest experience.

1. In GitHub **Settings** → **Pages**, enter `attendance.nousomplex.com` as the custom domain.
2. In the DNS provider that manages `nousomplex.com`, add a `CNAME` record:

```text
Host/Name: attendance
Target: YOUR-GITHUB-USERNAME.github.io
```

3. Wait for GitHub Pages to verify DNS, then enable **Enforce HTTPS**.
4. In Supabase **Authentication** → **URL Configuration**, set the Site URL to `https://attendance.nousomplex.com` and add it to Redirect URLs.

## Add it to your Odoo SaaS website

The best option is an Odoo website button:

1. On `www.nousomplex.com`, open Website → Edit.
2. Add a Button block with the label **Attendance Portal**.
3. Set its link to `https://attendance.nousomplex.com` (or your GitHub Pages address).
4. Save and publish.

You can also use Odoo Website’s **Embed Code** block and add:

```html
<iframe src="https://attendance.nousomplex.com"
  title="Nousomplex Attendance Portal"
  style="width:100%; min-height:900px; border:0; border-radius:12px;">
</iframe>
```

Use the button if the embedded portal does not fit well on mobile screens.

## Reports

The Reports page defaults to the current month. For a daily report select the same date in both fields; for a yearly report select 1 January to 31 December. Use **Download Excel** for `.xlsx`, or **Print / Save PDF** and choose *Save as PDF* in the browser print dialog.

## Local preview

You can open `index.html` directly for the login screen, though Supabase authentication works best from the published HTTPS URL. Do not create local copies of production data.
