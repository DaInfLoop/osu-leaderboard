const { App, ExpressReceiver } = (await import("@slack/bolt"));
import postgres from "postgres";
import "dotenv/config";
import bcrypt from "bcrypt";

const sql = postgres({
    host: '/var/run/postgresql',
    database: 'haroon_osu',
    username: 'haroon'
})

const receiver = new ExpressReceiver({ signingSecret: process.env.SLACK_SIGNING_SECRET! })

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    receiver,
    installerOptions: {
        port: 41691
    }
});

const states = new Map();

app.command("/osu-link", async (ctx) => {
    await ctx.ack();

    const [exists = null] = await sql`SELECT osu_id FROM links WHERE slack_id = ${ctx.context.userId}`;

    if (exists) {
        return ctx.respond({
            text: "This slack account is already linked to an osu! account.",
            unfurl_links: true,
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: "mrkdwn",
                        text: `This slack account is already linked to an <https://osu.ppy.sh/users/${exists.osu_id}/|osu! account>.`
                    }
                }
            ]

        })

        return;
    }

    const verifCode = `OSULEADERBOARD-${ctx.context.userId}-${Date.now()}`;

    states.set(ctx.context.userId, verifCode);

    const encodedCode = await bcrypt.hash(verifCode, 10);

    ctx.respond({
        replace_original: true,
        text: "View this message in your client to verify!",
        blocks: [
            {
                type: 'section',
                text: {
                    type: "mrkdwn",
                    text: `Hey <@${ctx.context.userId}>! To link your osu! account to your Slack account, click this button:`
                },
                "accessory": {
                    "type": "button",
                    "text": {
                        "type": "plain_text",
                        "text": "Link account",
                        "emoji": true
                    },
                    "value": "link",
                    "url": `https://osu.ppy.sh/oauth/authorize?client_id=33126&redirect_uri=https://osu.haroon.hackclub.app/osu/callback&response_type=code&state=${encodeURIComponent(ctx.context.userId + ":" + encodedCode)}`,
                    "action_id": "link"
                }
            }
        ]
    })
})

receiver.router.get("/osu/callback", async (req, res) => {
    res.contentType("text/html")

    const code = req.query.code as string;
    const state = req.query.state as string;

    const [userId, hash] = state.split(':');

    try {
        const isValid = await bcrypt.compare(states.get(userId), hash);

        if (!isValid) {
            throw new Error();
        }
    } catch (err) {
        return res.send(`Something went wrong: <br><br>Your state was invalid. Please re-authenticate. (invalid_state)<br><br>This has been reported.`)
    }

    states.delete(userId);

    const data = await fetch("https://osu.ppy.sh/oauth/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: `client_id=33126&client_secret=${encodeURIComponent(process.env.CLIENT_SECRET!)}&code=${code}&grant_type=authorization_code&redirect_uri=${encodeURIComponent("https://osu.haroon.hackclub.app/osu/callback")}`
    }).then(res => res.json());

    if (data.error) {
        console.log(data)
        return res.send(`Something went wrong: <br><br>${data.message} (${data.error})<br><br>This has been reported.`)
    } else {
        const user = await fetch("https://osu.ppy.sh/api/v2/me", {
            headers: {
                "Authorization": `Bearer ${data.access_token}`
            }
        }).then(res => res.json());

        // {user.id} - osu! user ID
        // userId - slack user ID

        await sql`INSERT INTO links VALUES (${user.id}, ${userId})`

        return res.send(`Your osu! account (${user.id}) has been successfully linked to your Slack account (${userId})!`)
    }
})

async function getTemporaryToken() {
    const data = await fetch("https://osu.ppy.sh/oauth/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: `client_id=33126&client_secret=${encodeURIComponent(process.env.CLIENT_SECRET!)}&grant_type=client_credentials&scope=public`
    }).then(res => res.json());

    return data.access_token;
}

/// GENERATED ///
function splitArray<T>(arr: T[], maxElements: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < arr.length; i += maxElements) {
        result.push(arr.slice(i, i + maxElements));
    }
    return result;
}
/// GENERATED ///

const cache: { 
    username: string, 
    id: number, 
    score: {
        osu: number,
        taiko: number
        fruits: number,
        mania: number
    } 
}[] = []

async function getLeaderboard() {
    const token = await getTemporaryToken();

    const users = await sql`SELECT * FROM links`;

    let lb = [];

    const osuUsers = users.map(user => user.osu_id);

    for (let list of splitArray<string>(osuUsers, 50)) {
        const query = list.map((user) => `ids[]=${user}`).join("&");

        const data = await fetch(`https://osu.ppy.sh/api/v2/users?${query}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        }).then(res => res.json());

        lb.push(...data.users.map(user => ({
            username: user.username,
            id: user.id,
            score: {
                osu: user.statistics_rulesets.osu.total_score,
                taiko: user.statistics_rulesets.taiko.total_score,
                fruits: user.statistics_rulesets.fruits.total_score,
                mania: user.statistics_rulesets.mania.total_score,

            }
        })))
    }

    cache.length = 0;

    cache.push(...lb);

    return lb
}

; (async () => {
    await app.start(41691);

    console.log('⚡️ Bolt app is running!');
})();