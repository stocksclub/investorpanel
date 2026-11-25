# The Investor Panel

A free website with two pages:

- **Score a stock** (`index.html`): eight famous investors score any U.S. company. S&P 500 companies load instantly; any other company works by dropping in its SEC data file.
- **S&P 500** (`sp500.html`): the whole index scored as one company, each investor's favorite stock, and a ranking of all 500.

Everything runs on GitHub's free services. No AI and no paid data are involved.

## How the data stays fresh

A GitHub Actions workflow (`.github/workflows/update-and-publish.yml`) runs every weekday evening:

1. **Once a week** it downloads every S&P 500 company's financial data from the SEC (`scripts/update-fundamentals.mjs`). The company list comes from Wikipedia's S&P 500 page.
2. **Every run** it fetches the latest closing prices (`scripts/update-prices.mjs`).
3. It saves the results in `data/` and republishes the site.

Scoring happens in the visitor's browser with the same code (`assets/core.js`) that the data job uses, so every page always agrees.

## One-time setup (about 15 minutes)

1. **Make a free GitHub account** at github.com if you don't have one.
2. **Create a new repository.** Click **New**, name it (for example `investor-panel`), choose **Public**, and click **Create repository**. (Free accounts can only publish public repositories as websites.)
3. **Upload the files.** On the new repository's page, click **uploading an existing file** and drag in everything from this folder, then click **Commit changes**.
   - Computers often hide folders that start with a dot, so the `.github` folder may not upload. To check, look for a `.github` folder in the repository. If it's missing, click **Add file → Create new file**, type `.github/workflows/update-and-publish.yml` as the name, paste in the contents of that file from this folder, and commit.
4. **Tell the SEC who you are.** The SEC asks every program that downloads its data for a contact email. Go to **Settings → Secrets and variables → Actions → Variables tab → New repository variable**. Name it `SEC_USER_AGENT` and set the value to something like `Stock Club yourname@example.com`.
5. **Turn on the website.** Go to **Settings → Pages** and under **Source** choose **GitHub Actions**.
6. **Build the data for the first time.** Go to the **Actions** tab, click **Update data and publish**, click **Run workflow**, check **Re-download every company's SEC filings now**, and click the green **Run workflow** button. The first run takes about 5–10 minutes.

Your site will be at `https://YOUR-USERNAME.github.io/REPOSITORY-NAME/`.

## Good to know

- **If updates stop:** GitHub pauses scheduled workflows in repositories with no activity for 60 days. The daily data commits normally keep it active, but if updates ever stop, open the **Actions** tab and re-enable the workflow.
- **Prices** come from free public sources (Yahoo Finance, with Stooq as a backup), which is fine for a free club website. If you ever charge for the site, switch to a licensed price provider, since free sources generally don't allow commercial use.
- **Changing the site:** edit any file on GitHub and commit. The workflow republishes the site automatically.
