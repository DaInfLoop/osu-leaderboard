import type { User } from "@slack/web-api/dist/response/UsersInfoResponse";

const { App, ExpressReceiver } = (await import("@slack/bolt"));
import postgres from "postgres";
import "dotenv/config";
import bcrypt from "bcrypt";
import type { StaticSelectAction } from "@slack/bolt";
import { inspect } from "node:util";
import { scheduleJob } from "node-schedule";

// @ts-expect-error No typings :)))))))))))
import osr from "node-osr";
import { Client, Events } from "ordr.js";

import io from "socket.io-client";
import fs from "fs";

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

const ordr = new Client(process.env.ORDR_TOKEN!);

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
                    "url": `https://osu.ppy.sh/oauth/authorize?client_id=33126&redirect_uri=https://osu.haroon.hackclub.app/osu/callback&response_type=code&state=${encodeURIComponent(ctx.context.userId + ":" + encodedCode)}&scope=public`,
                    "action_id": "link"
                }
            }
        ]
    })
})

receiver.router.get("/osu/callback", async (req, res) => {
    res.contentType("text/html")

    if (req.query.error) {
        return res.send(`Something went wrong: <br><br>${req.query.error_description} (${req.query.error})<br><br>This has been reported.`)
    }

    const code = req.query.code as string;
    const state = req.query.state as string;

    let _userId

    try {
        const [userId, hash] = state.split(':');

        const isValid = await bcrypt.compare(states.get(userId), hash);

        if (!isValid) {
            throw new Error();
        }

        _userId = userId

        states.delete(userId);
    } catch (err) {
        return res.send(`Something went wrong: <br><br>Your state was invalid. Please re-authenticate. (invalid_state)<br><br>This has been reported.`)
    }


    const data = await fetch("https://osu.ppy.sh/oauth/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: `client_id=33126&client_secret=${encodeURIComponent(process.env.CLIENT_SECRET!)}&code=${code}&grant_type=authorization_code&scope=public&redirect_uri=${encodeURIComponent("https://osu.haroon.hackclub.app/osu/callback")}`
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

        await sql`INSERT INTO links VALUES (${user.id}, ${_userId}, ${data.refresh_token})`

        cacheStuff();

        return res.send(`Your osu! account (${user.id}) has been successfully linked to your Slack account (${_userId})!`)
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

async function getAccessToken(slack_id: string): Promise<string | null> {
    const user = await sql`SELECT * FROM links WHERE slack_id = ${slack_id}`;

    if (!user.length) return null

    try {
        const data = await fetch("https://osu.ppy.sh/oauth/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: `client_id=33126&client_secret=${encodeURIComponent(process.env.CLIENT_SECRET!)}&grant_type=refresh_token&refresh_token=${user[0].refresh_token}&scope=public`
        }).then(res => res.json());

        await sql`UPDATE links SET refresh_token = ${data.refresh_token} WHERE slack_id = ${slack_id}`;

        return data.access_token;
    } catch (err) {
        console.error(err)
        return null
    }
}

async function sendGET<T>(path: string, token?: string): Promise<T> {
    const _token = token || await getTemporaryToken();

    const data = await fetch(`https://osu.ppy.sh/api/v2/${path}`, {
        headers: {
            'Authorization': `Bearer ${_token}`
        }
    }).then(res => res.json());

    return data as T
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

type CacheUser = {
    username: string;
    id: number;
    slackId: string;
    score: {
        osu: number;
        taiko: number;
        fruits: number;
        mania: number;
    };
}

const cache: CacheUser[] = []

const multiplayerRoundCache: any[] = [];

const sentWarningDM = {
    ref: false
}

async function cacheStuff(): Promise<void> {
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

        const data = await sendGET(`users?${query}`)

        // @ts-ignore i can't be bothered to type this rn
        lb.push(...data.users.map(user => ({
            username: user.username,
            id: user.id,
            slackId: osuUsers.find(v => v[0] == user.id)![1],
            score: {
                osu: Math.floor(user.statistics_rulesets.osu?.pp) || 0,
                taiko: Math.floor(user.statistics_rulesets.taiko?.pp) || 0,
                fruits: Math.floor(user.statistics_rulesets.fruits?.pp) || 0,
                mania: Math.floor(user.statistics_rulesets.mania?.pp) || 0,
            }
        })))
    }

    cache.length = 0;

    cache.push(...lb);

    // Multiplayer games

    multiplayerRoundCache.length = 0;

    const tohken = await getAccessToken("U06TBP41C3E") as string;

    if (!tohken) {
        const verifCode = `OSULEADERBOARD-U06TBP41C3E-${Date.now()}`;

        states.set('U06TBP41C3E', verifCode);

        const encodedCode = await bcrypt.hash(verifCode, 10);

        await app.client.chat.postMessage({
            channel: "U06TBP41C3E",
            text: "uh oh, your token seems to have expired!! multiplayer round fetching + daily challenges are disabled.",
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: "mrkdwn",
                        text: `uh oh, your token seems to have expired!! multiplayer round fetching + daily challenges are disabled.`
                    }
                },
                {
                    type: 'section',
                    text: {
                        type: "mrkdwn",
                        text: `Please re-authenticate to generate it by clicking the Reauthenticate button.`
                    },
                    "accessory": {
                        "type": "button",
                        "text": {
                            "type": "plain_text",
                            "text": "Reauthenticate",
                            "emoji": true
                        },
                        "value": "link",
                        "url": `https://osu.ppy.sh/oauth/authorize?client_id=33126&redirect_uri=https://osu.haroon.hackclub.app/osu/callback&response_type=code&state=${encodeURIComponent("U06TBP41C3E:" + encodedCode)}&scope=public`,
                        "action_id": "link"
                    }
                },
            ]
        })

        sentWarningDM.ref = true;

        return
    };

    const rooms = await fetch(`https://osu.ppy.sh/api/v2/rooms?category=realtime`, {
        headers: {
            'Authorization': `Bearer ${tohken}`
        }
    }).then(res => res.json());

    multiplayerRoundCache.push(...rooms);
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
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": `*Slack Username*: <https://hackclub.slack.com/team/${slackProfile.id}|${slackProfile.profile!.display_name_normalized}>\n*osu! username:* Not linked`
                        },
                        "accessory": {
                            "type": "image",
                            "image_url": 'https://osu.ppy.sh/images/layout/avatar-guest@2x.png',
                            "alt_text": `default osu profile picture`
                        }
                    }

                ]
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
            const token = await getTemporaryToken();

            const osuProfile = await fetch(`https://osu.ppy.sh/api/v2/users/${arg}?key=username`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }).then(res => res.json());

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
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": `*Slack Username*: Not linked\n*osu! username:* <https://osu.ppy.sh/users/${osuProfile.id}|${osuProfile.username}>`
                        },
                        "accessory": {
                            "type": "image",
                            "image_url": osuProfile.avatar_url,
                            "alt_text": `${osuProfile.username}'s osu profile picture`
                        }
                    }

                ]
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
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": `*Slack Username*: <https://hackclub.slack.com/team/${slackProfile.id}|${slackProfile.profile!.display_name_normalized}>\n*osu! username:* Not linked`
                        },
                        "accessory": {
                            "type": "image",
                            "image_url": 'https://osu.ppy.sh/images/layout/avatar-guest@2x.png',
                            "alt_text": `default osu profile picture`
                        }
                    }

                ]
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

    const cached = splitArray<CacheUser>(cache.sort((a, b) => {
        return b.score.osu - a.score.osu
    }), 10);

    const users = [];

    for (let i in cached[0]) {
        try {
            const cachedU = cached[0][i];
            const slackInfo = await ctx.client.users.info({ user: cachedU.slackId })
            const slackProfile = slackInfo.user!;

            users.push(`${users.length + 1}. <https://hackclub.slack.com/team/${slackProfile.id}|${slackProfile.profile!.display_name_normalized}> / <https://osu.ppy.sh/users/${cachedU.id}|${cachedU.username}> - ${cachedU.score.osu.toLocaleString()}`)
        } catch (e) {
            console.error(e)
            continue;
        }
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
                    "action_id": "change-leaderboard|" + ctx.context.userId
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

    const selected = action.selected_option.value as "osu" | "taiko" | "fruits" | "mania";

    const cached = splitArray<any>(cache.sort((a, b) => {
        return b.score[selected] - a.score[selected]
    }), 10)[0];

    const users = [];

    for (let i in cached) {
        try {
            const cachedU = cached[i];
            const slackProfile = (await ctx.client.users.info({ user: cachedU.slackId })).user!;

            users.push(`${users.length + 1}. <https://hackclub.slack.com/team/${slackProfile.id}|${slackProfile.profile!.display_name_normalized}> / <https://osu.ppy.sh/users/${cachedU.id}|${cachedU.username}> - ${cachedU.score[selected].toLocaleString()}`)
        } catch (e) {
            console.error(e)
            continue;
        }
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
                    "action_id": "change-leaderboard|" + userId
                }
            }
        ]
    })
})

app.command("/osu-multiplayer-invite", async (ctx) => {
    await ctx.ack();
    const me = cache.find(user => user.slackId == ctx.context.userId);

    if (!me) {
        return ctx.respond({
            response_type: 'ephemeral',
            text: `Hey <@${ctx.context.userId}>, you haven't linked your osu! account to your Slack account. Run /osu-link and then run this command.`,
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `Hey <@${ctx.context.userId}>, you haven't linked your osu! account to your Slack account. Run \`/osu-link\` and then run this command.`
                    }
                }
            ]
        });
    }

    const ownedRoom = multiplayerRoundCache.find(room => room.host.id == me.id && room.active);

    if (!ownedRoom) {
        return ctx.respond({
            response_type: 'ephemeral',
            text: `Hey <@${ctx.context.userId}>, you aren't in a multiplayer room. If you are, make sure you're the host of the room, and you're on osu!lazer. If this is still happening, my cache may need reloading. Wait about a minute before running the command again.`,
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `Hey <@${ctx.context.userId}>, you aren't in a multiplayer room. If you are, make sure you're the host of the room, and you're on osu!lazer. If this is still happening, my cache may need reloading. Wait about a minute before running the command again.`,
                    }
                }
            ]
        });
    }

    const ratings = ownedRoom.playlist.map((x: any) => x.beatmap.difficulty_rating);

    const min = Math.min(...ratings);
    const max = Math.max(...ratings);

    const currentSong = ownedRoom.playlist.find((x: any) => !x.expired)

    const ruleset = [":osu-standard: osu!standard", ":osu-taiko: osu!taiko", ":osu-catch: osu!catch", ":osu-mania: osu!mania"][ownedRoom.playlist[0].ruleset_id]

    return ctx.respond({
        response_type: 'in_channel',
        "blocks": [
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": `<@${ctx.context.userId}> ran \`/osu-multiplayer-invite\` | ${ruleset}${ownedRoom.has_password ? " | Password required" : ""}`
                    }
                ]
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": `*Room*: ${ownedRoom.name}\n*Star Rating*: ${min} - ${max}\n\n*Currently playing:* <https://osu.ppy.sh/beatmapsets/${currentSong.beatmap.beatmapset_id}#osu/${currentSong.beatmap.id}|${currentSong.beatmap.beatmapset.title_unicode} - ${currentSong.beatmap.beatmapset.artist_unicode} (${currentSong.beatmap.difficulty_rating})>`
                },
                "accessory": {
                    "type": "image",
                    "image_url": ownedRoom.host.avatar_url,
                    "alt_text": `${ownedRoom.host.username}'s osu profile picture`
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": "Join this lobby:"
                },
                "accessory": {
                    "type": "button",
                    "text": {
                        "type": "plain_text",
                        "text": "Join",
                        "emoji": true
                    },
                    "value": "link",
                    "url": `osu://mp/${ownedRoom.id}`,
                    "action_id": "link"
                }
            }
        ]

    })
})

receiver.router.get('/osu/news.rss', async (req, res) => {
    const news = await fetch('https://osu.ppy.sh/api/v2/news').then(res => res.json());

    const posts = news.news_posts;

    const out = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
    <channel>
        <title>osu!news</title>
        <link>https://osu.haroon.hackclub.app/home/news</link>
        <atom:link rel="self" type="application/rss+xml" href="https://osu.haroon.hackclub.app/osu/news.rss" />
        <description>Latest news on osu!</description>
        <language>en-us</language>
        <ttl>60</ttl>
        <image>
            <url>https://raw.githubusercontent.com/ppy/osu-web/master/public/images/favicon/favicon-32x32.png</url>
            <title>osu!news</title>
            <link>https://osu.haroon.hackclub.app/home/news</link>
        </image>

        ${posts.map((post: any) =>
        `<item>
            <title>${post.title}</title>
            <link>https://osu.haroon.hackclub.app/home/news/${post.slug}</link>
            <guid isPermaLink="false">${post.id}</guid>
            <pubDate>${new Date(post.published_at).toLocaleString('en-GB', { timeZone: 'UTC', hour12: false, weekday: 'short', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', }).replace(/(?:(\d),)/, '$1') + ' GMT'}</pubDate>
            <description>${post.preview}</description>
            <enclosure url="${post.first_image}" type="image/jpg"/>
        </item>`
    ).join('\n        ')}
    </channel>
</rss>`;

    res.contentType("application/rss+xml")
    res.send(out)
});

app.command('/osu-eval', async (ctx) => {
    await ctx.ack();

    if (ctx.context.userId != 'U06TBP41C3E') return;

    const resp = inspect(await eval(ctx.body.text), undefined, 1)

    ctx.respond({
        text: resp,
        response_type: 'ephemeral',
        blocks: [
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: "```" + resp + "```"
                }
            }
        ]
    })
})

app.command('/osu-search', async (ctx) => {
    await ctx.ack();

    const me = cache.find(user => user.slackId == ctx.context.userId);

    if (!me) {
        return ctx.respond({
            response_type: 'ephemeral',
            text: `Hey <@${ctx.context.userId}>, you haven't linked your osu! account to your Slack account. Run /osu-link and then run this command.`,
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `Hey <@${ctx.context.userId}>, you haven't linked your osu! account to your Slack account. Run \`/osu-link\` and then run this command.`
                    }
                }
            ]
        });
    }

    const accessToken = await getAccessToken(ctx.context.userId!);

    if (!accessToken) {
        const verifCode = `OSULEADERBOARD-${ctx.context.userId}-${Date.now()}`;

        states.set(ctx.context.userId, verifCode);

        const encodedCode = await bcrypt.hash(verifCode, 10);

        return ctx.respond({
            response_type: 'ephemeral',
            text: `Hey <@${ctx.context.userId}>, your token has expired. Please re-authenticate to generate it by clicking the Reauthenticate button.`,
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `Hey <@${ctx.context.userId}>, your token has expired. Please re-authenticate to generate it by clicking the \`Reauthenticate\` button.`
                    },
                    "accessory": {
                        "type": "button",
                        "text": {
                            "type": "plain_text",
                            "text": "Reauthenticate",
                            "emoji": true
                        },
                        "value": "link",
                        "url": `https://osu.ppy.sh/oauth/authorize?client_id=33126&redirect_uri=https://osu.haroon.hackclub.app/osu/callback&response_type=code&state=${encodeURIComponent(ctx.context.userId + ":" + encodedCode)}&scope=public`,
                        "action_id": "link"
                    }
                },
            ]
        });
    }

    ctx.client.views.open({
        trigger_id: ctx.payload.trigger_id,
        view: {
            "type": "modal",
            "callback_id": "search",
            private_metadata: ctx.payload.channel_id,
            "title": {
                "type": "plain_text",
                "text": "Search for a beatmap",
                "emoji": true
            },
            "submit": {
                "type": "plain_text",
                "text": "Search",
                "emoji": true
            },
            "close": {
                "type": "plain_text",
                "text": "Cancel",
                "emoji": true
            },
            "blocks": [
                {
                    "type": "input",
                    block_id: "keywords",
                    "element": {
                        "type": "plain_text_input",
                        "action_id": "keywords"
                    },
                    "label": {
                        "type": "plain_text",
                        "text": "Keywords",
                        "emoji": true
                    },
                    optional: true
                },
                {
                    "type": "input",
                    "block_id": "rating",
                    "element": {
                        "type": "number_input",
                        "is_decimal_allowed": true,
                        "action_id": "rating"
                    },
                    "label": {
                        "type": "plain_text",
                        "text": "Rating",
                        "emoji": true
                    },
                    optional: true
                },
                {
                    "type": "input",
                    "block_id": "gamemode",
                    "element": {
                        "type": "static_select",
                        "placeholder": {
                            "type": "plain_text",
                            "text": "Choose an item",
                            "emoji": true
                        },
                        "options": [
                            {
                                "text": {
                                    "type": "plain_text",
                                    "text": "osu!standard",
                                    "emoji": true
                                },
                                "value": "osu"
                            },
                            {
                                "text": {
                                    "type": "plain_text",
                                    "text": "osu!taiko",
                                    "emoji": true
                                },
                                "value": "taiko"
                            },
                            {
                                "text": {
                                    "type": "plain_text",
                                    "text": "osu!catch",
                                    "emoji": true
                                },
                                "value": "fruits"
                            },
                            {
                                "text": {
                                    "type": "plain_text",
                                    "text": "osu!mania",
                                    "emoji": true
                                },
                                "value": "mania"
                            }
                        ],
                        "action_id": "gamemode"
                    },
                    "label": {
                        "type": "plain_text",
                        "text": "Gamemode",
                        "emoji": true
                    }
                },
                // @ts-expect-error initial_option does exist and work.
                {
                    "type": "actions",
                    "block_id": "ranked",
                    "elements": [
                        {
                            "type": "radio_buttons",
                            "initial_option": {
                                "text": {
                                    "type": "mrkdwn",
                                    "text": "*Ranked*"
                                },
                                "description": {
                                    "type": "mrkdwn",
                                    "text": "Maps that will give you Performance Points"
                                },
                                "value": "ranked"
                            },
                            "options": [
                                {
                                    "text": {
                                        "type": "mrkdwn",
                                        "text": "*Graveyard*"
                                    },
                                    "description": {
                                        "type": "mrkdwn",
                                        "text": "Maps that were previously ranked and gave you Performance Points"
                                    },
                                    "value": "graveyard"
                                },
                                {
                                    "text": {
                                        "type": "mrkdwn",
                                        "text": "*Ranked*"
                                    },
                                    "description": {
                                        "type": "mrkdwn",
                                        "text": "Maps that will give you Performance Points"
                                    },
                                    "value": "ranked"
                                },
                                {
                                    "text": {
                                        "type": "mrkdwn",
                                        "text": "*Loved*"
                                    },
                                    "description": {
                                        "type": "mrkdwn",
                                        "text": "Maps that will not give you Performance Points but suggested by the community"
                                    },
                                    "value": "loved"
                                }
                            ],
                            "action_id": "ranked"
                        }
                    ]
                }
            ]
        }
    })
})

app.view("search", async (ctx) => {
    await ctx.ack();

    const options = {
        keywords: ctx.payload.state.values["keywords"]["keywords"]?.value || "",
        rating: ctx.payload.state.values["rating"]["rating"]?.value || "",
        gamemode: ctx.payload.state.values["gamemode"]["gamemode"].selected_option!.value,
        ranked: ctx.payload.state.values["ranked"]["ranked"].selected_option!.value,
    }

    const url = new URL("https://osu.ppy.sh/api/v2/beatmapsets/search");

    url.searchParams.set("e", "")
    url.searchParams.set("c", "")
    url.searchParams.set("g", "")
    url.searchParams.set("l", "")
    url.searchParams.set("m", ["osu", "taiko", "fruits", "mania"].indexOf(options.gamemode).toString())
    url.searchParams.set("nsfw", "")
    url.searchParams.set("played", "")
    url.searchParams.set("q", options.keywords)
    url.searchParams.set("r", "")
    url.searchParams.set("sort", "")
    url.searchParams.set("s", options.ranked);

    const data = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${await getAccessToken(ctx.context.userId!)}`
        }
    }).then(res => res.json());

    const set = data.beatmapsets[0];

    ctx.client.chat.postMessage({
        channel: ctx.view.private_metadata,
        "blocks": [
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": `<@${ctx.context.userId}> searched for a map`
                    }
                ]
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": `*Beatmap:* ${set.title_unicode} - ${set.artist_unicode}\n*Mapper:* ${set.creator}\n\n<https://osu.ppy.sh/beatmapsets/${set.id}|*View this set on the osu! website*>`
                }
            },
            {
                "type": "image",
                "image_url": set.covers.card,
                "alt_text": "beatmap card"
            }
        ]

    })
})

receiver.router.get('*', (req, res) => {
    res.redirect(`https://osu.ppy.sh${req.path}`)
})

enum Mods {
    EZ = "Easy",
    NF = "No Fail",
    HT = "Half Time",
    HR = "Hard Rock",
    SD = "Sudden Death",
    PF = "Perfect",
    DT = "Double Time",
    NC = "Nightcore",
    HD = "Hidden",
    FI = "Fade In",
    FL = "Flashlight",
    RL = "Relax",
    AP = "Autopilot",
    SO = "Spun Out",
    "1K" = "One Key",
    "2K" = "Two Keys",
    "3K" = "Three Keys",
    "4K" = "Four Keys",
    "5K" = "Five Keys",
    "6K" = "Six Keys",
    "7K" = "Seven Keys",
    "8K" = "Eight Keys",
    "9K" = "Nine Keys",
    "10K" = "Ten Keys"
}

async function debugDailyChallenge() {
    // Daily Challenge!!

    const tohken = await getAccessToken("U06TBP41C3E");

    const rooms: any[] = await fetch(`https://osu.ppy.sh/api/v2/rooms`, {
        headers: {
            'Authorization': `Bearer ${tohken}`,
            'X-Api-Version': '20240529'
        }
    }).then(res => res.json());

    const dailyChallenge = rooms.find(room => room.host.id == 3 && room.active && room.category == "daily_challenge");

    const currentSong = dailyChallenge.current_playlist_item

    const ruleset = [":osu-standard: osu!standard", ":osu-taiko: osu!taiko", ":osu-catch: osu!catch", ":osu-mania: osu!mania"][currentSong.ruleset_id]

    return app.client.chat.postMessage({
        channel: "C165V7XT9",
        text: "A new daily challenge has started!",
        "blocks": [
            {
                "type": "header",
                text: {
                    text: ruleset.split(' ').shift() + " A new daily challenge has started!",
                    emoji: true,
                    type: "plain_text"
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": `<https://osu.ppy.sh/beatmapsets/${currentSong.beatmap.beatmapset_id
                        }#osu/${currentSong.beatmap.id
                        }|${currentSong.beatmap.beatmapset.title
                        } - ${currentSong.beatmap.beatmapset.artist
                        } (${currentSong.beatmap.difficulty_rating
                        })>
                    
*Ruleset:* ${ruleset}
*Required mods:* ${currentSong.required_mods.length === 0 ? "None" : currentSong.required_mods.map((mod: any) =>
                            // @ts-ignore I HATE THIS
                            Mods[mod.acronym] || mod.acronym
                        ).join(', ')}`
                },
                "accessory": {
                    "type": "image",
                    "image_url": dailyChallenge.host.avatar_url,
                    "alt_text": `${dailyChallenge.host.username}'s osu profile picture`
                }
            }
        ],
        unfurl_links: true
    })
}

type QueueJob = {
    md5: string,
    playerName: string,
    ts: string,
    userId: string
}

const queue: QueueJob[] = []
// key is renderID
const waiting = new Map<number, QueueJob>()

const processQueue = async () => {
    if (queue.length > 0) {
        const job = queue.shift()!;

        setTimeout(processQueue, 5000)

        app.client.reactions.add({
            channel: "C165V7XT9",
            name: "thinkspin",
            timestamp: job.ts
        })

        const render = await ordr.sendRender({
            replay: `replay-${job.md5}.osr`,
            skin: 'default',
            username: job.playerName,
            showDanserLogo: false,
            resolution: '1280x720',
            introBGDim: 100,
            inGameBGDim: 100,
            breakBGDim: 100
        })

        console.log(render)

        // @ts-ignore Error code 0 DOES exist: https://ordr.issou.best/docs/#section/Error-codes
        if (render.errorCode !== 0) {
            app.client.chat.postEphemeral({
                channel: "C165V7XT9",
                user: job.userId,
                text: `Hey: it looks like you posted a replay! Unfortunately, I couldn't generate a video of it: "${render.message}"`
            })
            return
        }

        waiting.set(render.renderID!, job);
    }
};

const socket = io('https://apis.issou.best', {
    path: '/ordr/ws',
    autoConnect: false
})

socket.on('connect', () => {
    console.log('Connected to ordr websocket!')
})

socket.on('disconnect', reason => {
    if (reason == "io server disconnect") {
        socket.connect()
    }
})

socket.on('render_done_json', async (render) => {
    const job = waiting.get(render.renderID!);

    if (!job) return;

    app.client.chat.postMessage({
        channel: 'C165V7XT9',
        thread_ts: job.ts,
        reply_broadcast: true,
        text: `<${render.videoUrl}|replay-${job.md5}.mp4>`,
        unfurl_media: true
    })

    app.client.reactions.remove({
        channel: "C165V7XT9",
        name: "thinkspin",
        timestamp: job.ts
    })

    waiting.delete(render.renderID!);
})

const addToQueue = (job: QueueJob) => {
    queue.push(job);
    if (queue.length === 1) {
        processQueue();
    }
};

app.event("message", async (ctx) => {
    if (ctx.event.channel != "C165V7XT9") return;
    if (ctx.event.subtype != "file_share") return;
    const ts = ctx.event.ts;

    const history = await ctx.client.conversations.history({
        channel: "C165V7XT9",
        latest: ts,
        limit: 1,
        inclusive: true
    })

    if (!(history.messages && history.messages.length > 0)) {
        return;
    }

    const message = history.messages[0];

    if (!message.files) return;
    if (message.files.length === 0) return;

    const replay = message.files.find(file => file.name?.endsWith(".osr"));

    if (!replay) return;

    const replayData = await fetch(replay.url_private_download!, {
        headers: {
            'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
        }
    }).then(res => res.arrayBuffer());

    const replayBuffer = Buffer.from(replayData);

    const _replay = await osr.read(replayBuffer);

    if (_replay.gameMode !== 0) {
        ctx.client.chat.postEphemeral({
            channel: "C165V7XT9",
            user: ctx.context.userId!,
            text: "Hey: it looks like you posted a replay! Unfortunately, it's not an :osu-standard: osu!standard replay, and so I can't generate a video of it. Sorry!"
        })
        return;
    }

    const replayFile = fs.createWriteStream(`replay-${_replay.replayMD5}.osr`);

    replayFile.write(replayBuffer);
    replayFile.end();


    replayFile.on('finish', () => {
        addToQueue({
            md5: _replay.replayMD5,
            playerName: _replay.playerName,
            ts: ts,
            userId: ctx.context.userId!
        })
    });
})

    ; (async () => {
        await app.start(41691);

        console.log('⚡️ Bolt app is running!');

        socket.connect();

        cacheStuff();

        setInterval(cacheStuff, 60 * 1000) // Cache every minute. Ratelimit is 1200 req/m anyways.

        scheduleJob('30 5 0 * * *', debugDailyChallenge)
    })();
