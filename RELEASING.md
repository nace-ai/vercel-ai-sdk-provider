# Releasing @nace-ai/ai-sdk-provider

The package version in `package.json` describes the source. Check npm before calling it released:

```sh
npm view @nace-ai/ai-sdk-provider version
```

A merge to `main` runs CI. It does not publish. The Release workflow publishes only on a pushed `v<package.json version>` tag. Running it manually validates and uploads a tarball without publishing.

## Validate the artifact

Use Node.js 24 and the pnpm version in `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check:pack
pnpm smoke
```

`npm pack` builds the JavaScript and declarations automatically. The smoke script installs that tarball in a fresh project, checks ESM/CommonJS imports and TypeScript examples, and runs `experimental_decide` against a mocked Nace response. It exercises the installed package rather than importing source files.

Set `NACE_LIVE_API_KEY` for the live contract tests and `NACE_API_KEY` for the packed README examples. Use a dedicated Nace test account with credit; these checks call production and consume a small amount of credit.

```sh
NACE_REQUIRE_LIVE=1 pnpm test:live
node scripts/smoke-pack.mjs --require-live
```

In GitHub, add the repository Actions secret `NACE_API_KEY_LIVE`. Both the Release and nightly Live contract workflows require it. Without that secret, they fail rather than reporting skipped tests as live coverage. Ordinary pull-request CI can still run without a key.

After this workflow change is on `main`, open **Actions → Release → Run workflow** on `main`. A successful run uploads the exact smoke-tested `package` artifact. The `publish` job is skipped on a manual run. Record the run URL and source commit with the release.

## First publication

When npm returns `E404` for this package, the first publication is a maintainer action. [npm's trust command requires an existing registry package](https://docs.npmjs.com/cli/v12/commands/npm-trust/#prerequisites), so the tag workflow alone cannot bootstrap it.

1. Run the manual validation above and download its `package` artifact.
2. Sign in to npm as a member authorized to publish under `@nace-ai`, with account 2FA enabled.
3. Inspect and publish the downloaded tarball once:

   ```sh
   npm login
   npm publish ./nace-ai-ai-sdk-provider-0.1.0.tgz --access public --provenance=false
   ```

4. Verify the public install:

   ```sh
   npm view @nace-ai/ai-sdk-provider@0.1.0 version dist.integrity
   node scripts/smoke-pack.mjs --registry --require-live
   ```

Do not push `v0.1.0` after manually publishing it: that would ask the tag workflow to publish the same immutable npm version again. Use the recorded validation commit/run for this initial release.

## Subsequent releases

Configure the npm package's trusted publisher for GitHub Actions:

| Setting           | Value                    |
| ----------------- | ------------------------ |
| Organization      | `nace-ai`                |
| Repository        | `vercel-ai-sdk-provider` |
| Workflow filename | `release.yml`            |
| Environment       | `npm-release`            |
| Permission        | Allow `npm publish`      |

Create the matching GitHub `npm-release` environment. Add a required reviewer if each release should have an approval click. Configure the trusted publisher shortly before the next release: a new, unused configuration expires after two days. Private source repositories can publish public packages, but do not get provenance; the workflow already handles that. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

For the next release, update `package.json`, its lockfile and `CHANGELOG.md`, merge the PR, and run manual validation on the intended commit. Push a matching version tag only when ready to publish. For example, after merging version `0.1.1`:

```sh
git tag v0.1.1 <validated-main-commit>
git push origin v0.1.1
```

The workflow validates the package, runs real text/image checks, and publishes the exact tested artifact through OIDC. Approve `npm-release` if a required reviewer is configured. Then run the registry smoke command above from the matching source revision. Creating a GitHub Release is optional; pushing the tag is the publication trigger.

## Provider scope and distribution

This package already implements the AI SDK 7 `DecisionModelV4` interface for boolean, choice and score questions, including Drex Max images. Its API call is `/v1/systemone`. It is separate from `nace-sdk`, Vercel AI Gateway's managed provider, and any future `/v1/route` helper.

After npm publication and making the provider source public, submit the documentation PR described in [AI SDK's community-provider guide](https://ai-sdk.dev/providers/community-providers/custom-providers#publishing-your-provider). Publishing this package does not itself add a community-provider listing or an AI Gateway integration.
