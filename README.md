# osu! leaderboard

osu! leaderboard is a project I worked on for Hack Club's Arcade.  
It allows for users to link their osu! account to their Slack accounts and view leaderboards for each ruleset (showing linked users), as well as search beatmaps and create invites to multiplayer matches all from Slack.

This currently runs in the Hack Club Slack in the [#osu](https://hackclub.slack.com/archives/C165V7XT9) channel.

## Commands

`/osu-link`: Starts the linking process.

`/osu-leaderboard`: Shows the leaderboard of all osu! users who are linked. This can be changed to show different rulesets via a dropdown.

`/osu-profile <user>`: Search for an osu! user or a Slack user and view (if any) the link between their accounts.

`/osu-search`: Opens a modal that allows you to filter for a beatmap.

`/osu-multiplayer-invite`: If you have linked your account, you can run this command to create a message to allow people to join an osu!lazer multiplayer room you create.

## Setup

(Please note; a lot of this is hardcoded! You may need to change a few references in the code to whereever you're hosting the bot.)

1. Clone the repo:
```
$ git clone https://git.haroon.hackclub.app/haroon/osu-leaderboard.git
```

2. Create a `.env` file with the following format:
```ini
SLACK_BOT_TOKEN=<your slack bot token (xoxb)>
SLACK_SIGNING_SECRET=<your slack signing secret>
CLIENT_SECRET=<your osu! oauth app's client secret>
```

3. Change the following hard-coded values (sorry!)
	a. lines 9-13: edit for your postgres installation

	b. line 76, 118, 152, 172: edit for your client ID and redirect URI

	c. line 262: edit to a linked user's slack ID (preferably yours)

	d. line 330, 443, 488, 598: edit the slack URL to your workspace's URL

	e. line 786, 787, 794, 800: edit to the URL where you're hosting the bot.

4. Install packages, using your package manager of choice.

5. Run `index.ts` using `npx tsx .`, not `bun .`! (Bolt likes to be funny when you're using Bun.)

6. Voila!
