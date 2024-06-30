import type { User } from "@slack/web-api/dist/response/UsersInfoResponse";

const { App, ExpressReceiver } = (await import("@slack/bolt"));
import postgres from "postgres";
import "dotenv/config";
import bcrypt from "bcrypt";
import type { StaticSelectAction } from "@slack/bolt";

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

    const [exists = null] = await sql`SELECT osu_id FROM links WHERE slack_id = ${ctx.context.userId!}`;

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

        getLeaderboard();

        return res.send(`Your osu! account (${user.id}) has been successfully linked to your Slack account (${userId})!`)
    }
})

let _token: string | null;

async function getTemporaryToken(): Promise<string> {
    if (_token) return _token;

    const data = await fetch("https://osu.ppy.sh/oauth/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: `client_id=33126&client_secret=${encodeURIComponent(process.env.CLIENT_SECRET!)}&grant_type=client_credentials&scope=public`
    }).then(res => res.json());

    _token = data.access_token;

    setTimeout(() => {
        _token = null;
    }, data.expires_in)

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
    slackId: string,
    score: {
        osu: number,
        taiko: number
        fruits: number,
        mania: number
    }
}[] = []

async function getLeaderboard(): Promise<{
    username: string,
    id: number,
    slackId: string,
    score: {
        osu: number,
        taiko: number
        fruits: number,
        mania: number
    }
}[]>
async function getLeaderboard(sortBy: "osu" | "taiko" | "fruits" | "mania", asc?: boolean): Promise<{
    username: string,
    id: number,
    slackId: string,
    score: {
        osu: number,
        taiko: number
        fruits: number,
        mania: number
    }
}[]>
async function getLeaderboard(sortBy?: "osu" | "taiko" | "fruits" | "mania", asc: boolean = true) {
    const token = await getTemporaryToken();

    const users = await sql`SELECT * FROM links`;

    let lb: {
        username: string,
        id: number,
        slackId: string,
        score: {
            osu: number,
            taiko: number
            fruits: number,
            mania: number
        }
    }[] = [];

    const osuUsers: string[][] = users.map(user => [user.osu_id, user.slack_id]);

    for (let list of splitArray<string[]>(osuUsers, 50)) {
        const query = list.map((user) => `ids[]=${user[0]}`).join("&");

        const data = await fetch(`https://osu.ppy.sh/api/v2/users?${query}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        }).then(res => res.json());

        // @ts-ignore i can't be bothered to type this rn
        lb.push(...data.users.map(user => ({
            username: user.username,
            id: user.id,
            slackId: osuUsers.find(v => v[0] == user.id)![1],
            score: {
                osu: user.statistics_rulesets.osu?.total_score || 0,
                taiko: user.statistics_rulesets.taiko?.total_score || 0,
                fruits: user.statistics_rulesets.fruits?.total_score || 0,
                mania: user.statistics_rulesets.mania?.total_score || 0,
            }
        })))
    }

    cache.length = 0;

    cache.push(...lb);

    if (sortBy) {
        lb = lb.sort((a, b) => {
            if (asc) return b.score[sortBy] - a.score[sortBy]
            else return a.score[sortBy] - b.score[sortBy]
        })
    }

    return lb
}

async function generateProfile(slackProfile: User) {
    const token = await getTemporaryToken();

    const osuProfile = await fetch(`https://osu.ppy.sh/api/v2/users/${cache.find(user => user.slackId == slackProfile.id)!.id}?key=id`, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    }).then(res => res.json());

    return [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": `*Slack Username*: <https://hackclub.slack.com/team/${slackProfile.id}|${slackProfile.profile!.display_name_normalized}>\n*osu! username:* <https://osu.ppy.sh/users/${osuProfile.id}|${osuProfile.username}>`
            },
            "accessory": {
                "type": "image",
                "image_url": osuProfile.avatar_url,
                "alt_text": `${osuProfile.username}'s osu profile picture`
            }
        }
    ]
}

app.command('/osu-profile', async (ctx) => {
    await ctx.ack();

    const userProfile = (await ctx.client.users.info({ user: ctx.context.userId! })).user!.profile!;

    const arg = ctx.command.text.slice();

    let match;

    if (match = arg.match(/\<\@(.+)\|(.+)>/)) {
        // Slack user
        const mentionedUser = match[1];
        const slackProfile = (await ctx.client.users.info({ user: mentionedUser })).user!;

        if (!cache.find(u => u.slackId == slackProfile.id)) {
            return ctx.respond({
                text: `${slackProfile.profile!.display_name_normalized} doesn't seem to have an osu! account linked. You might have to wait a bit for my cache to reload though.`
            })
        }

        return ctx.respond({
            response_type: 'in_channel',
            text: `${userProfile.display_name_normalized} ran /osu-profile @${slackProfile.profile!.display_name_normalized}`,
            blocks: [
                {
                    "type": "context",
                    "elements": [
                        {
                            "type": "mrkdwn",
                            "text": `<@${ctx.context.userId}> ran \`/osu-profile\` | Matched by slack user`
                        }
                    ]
                },
                ...await generateProfile(slackProfile)
            ]
        })
    } else if (arg) {
        // osu! user
        const cached = cache.find(u => u.username.toLowerCase() == arg.toLowerCase())

        if (!cached) {
            return ctx.respond({
                text: `${arg} doesn't seem to have an slack account linked. You might have to wait a bit for my cache to reload though.`
            })
        }

        const slackProfile = (await ctx.client.users.info({ user: cached.slackId })).user!;

        return ctx.respond({
            response_type: 'in_channel',
            text: `${userProfile.display_name_normalized} ran /osu-profile ${arg}`,
            blocks: [
                {
                    "type": "context",
                    "elements": [
                        {
                            "type": "mrkdwn",
                            "text": `<@${ctx.context.userId}> ran \`/osu-profile\` | Matched by osu! username`
                        }
                    ]
                },
                ...await generateProfile(slackProfile)
            ]
        })
    } else {
        // User's own profile
        const mentionedUser = ctx.context.userId!;
        const slackProfile = (await ctx.client.users.info({ user: mentionedUser })).user!;

        if (!cache.find(u => u.slackId == slackProfile.id)) {
            return ctx.respond({
                text: `You don't seem to have an osu! account linked. You might have to wait a bit for my cache to reload though.`
            })
        }

        return ctx.respond({
            response_type: 'in_channel',
            text: `${userProfile.display_name_normalized} ran /osu-profile`,
            blocks: [
                {
                    "type": "context",
                    "elements": [
                        {
                            "type": "mrkdwn",
                            "text": `<@${ctx.context.userId}> ran \`/osu-profile\` | Matched by no input`
                        }
                    ]
                },
                ...await generateProfile(slackProfile)
            ]
        })
    }
})

app.command('/osu-leaderboard', async (ctx) => {
    await ctx.ack();

    const cached = splitArray<any>(cache, 10)[0].sort((a, b) => {
        return b.score.osu - a.score.osu
    });

    const users = [];

    for (let i in cached) {
        const cachedU = cached[i];
        const slackProfile = (await ctx.client.users.info({ user: cachedU.slackId })).user!;

        users.push(`${parseInt(i) + 1}. <https://hackclub.slack.com/team/${slackProfile.id}|${slackProfile.profile!.display_name_normalized}> / <https://osu.ppy.sh/users/${cachedU.id}|${cachedU.username}> - ${cachedU.score.osu.toLocaleString()}`)
    }

    ctx.respond({
        response_type: 'in_channel',
        blocks: [
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": `<@${ctx.context.userId}> ran \`/osu-leaderboard\``
                    }
                ]
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": users.join('\n')
                }
            },
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": "*Current leaderboard:* :osu-standard: osu!standard"
                    }
                ]
            },
            {
                "type": "section",
                "block_id": "select",
                "text": {
                    "type": "mrkdwn",
                    "text": "Change leaderboard:"
                },
                "accessory": {
                    "type": "static_select",
                    "placeholder": {
                        "type": "plain_text",
                        "text": "Choose ruleset...",
                        "emoji": true
                    },
                    "options": [
                        {
                            "text": {
                                "type": "plain_text",
                                "text": ":osu-standard: osu!standard",
                                "emoji": true
                            },
                            "value": "osu"
                        },
                        {
                            "text": {
                                "type": "plain_text",
                                "text": ":osu-taiko: osu!taiko",
                                "emoji": true
                            },
                            "value": "taiko"
                        },
                        {
                            "text": {
                                "type": "plain_text",
                                "text": ":osu-catch: osu!catch",
                                "emoji": true
                            },
                            "value": "fruits"
                        },
                        {
                            "text": {
                                "type": "plain_text",
                                "text": ":osu-mania: osu!mania",
                                "emoji": true
                            },
                            "value": "mania"
                        }
                    ],
                    "action_id": "change-leaderboard|"+ctx.context.userId
                }
            }
        ]
    })
})

app.action("link", ({ ack }) => ack())

app.action(/change-leaderboard\|.+/, async (ctx) => {
    await ctx.ack();
    const action = ctx.action as StaticSelectAction

    const [_, userId] = action.action_id.split('|');

    if (userId != ctx.context.userId) {
        return ctx.respond({ replace_original: false, response_type: "ephemeral", text: `This leaderboard was initialised by <@${userId}>. Only they can manage it.` })
    }

    const selected = action.selected_option.value;

    const cached = splitArray<any>(cache, 10)[0].sort((a, b) => {
        return b.score[selected] - a.score[selected]
    });

    const users = [];

    for (let i in cached) {
        const cachedU = cached[i];
        const slackProfile = (await ctx.client.users.info({ user: cachedU.slackId })).user!;

        users.push(`${parseInt(i) + 1}. <https://hackclub.slack.com/team/${slackProfile.id}|${slackProfile.profile!.display_name_normalized}> / <https://osu.ppy.sh/users/${cachedU.id}|${cachedU.username}> - ${cachedU.score[selected].toLocaleString()}`)
    }

    ctx.respond({
        response_type: 'in_channel',
        blocks: [
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": `<@${ctx.context.userId}> ran \`/osu-leaderboard\``
                    }
                ]
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": users.join('\n')
                }
            },
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": `*Current leaderboard:* ${action.selected_option.text.text}`
                    }
                ]
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": "Change leaderboard:"
                },
                "accessory": {
                    "type": "static_select",
                    "placeholder": {
                        "type": "plain_text",
                        "text": "Choose ruleset...",
                        "emoji": true
                    },
                    "options": [
                        {
                            "text": {
                                "type": "plain_text",
                                "text": ":osu-standard: osu!standard",
                                "emoji": true
                            },
                            "value": "osu"
                        },
                        {
                            "text": {
                                "type": "plain_text",
                                "text": ":osu-taiko: osu!taiko",
                                "emoji": true
                            },
                            "value": "taiko"
                        },
                        {
                            "text": {
                                "type": "plain_text",
                                "text": ":osu-catch: osu!catch",
                                "emoji": true
                            },
                            "value": "fruits"
                        },
                        {
                            "text": {
                                "type": "plain_text",
                                "text": ":osu-mania: osu!mania",
                                "emoji": true
                            },
                            "value": "mania"
                        }
                    ],
                    "action_id": "change-leaderboard|"+userId
                }
            }
        ]
    })
})

    ; (async () => {
        await app.start(41691);

        console.log('⚡️ Bolt app is running!');

        getLeaderboard();

        setTimeout(getLeaderboard, 5 * 60 * 1000)
    })();