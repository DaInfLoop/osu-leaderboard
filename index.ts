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

/// GENERATED ///
type Room = {
    id: number;
    name: string;
    category: string;
    type: string;
    user_id: number;
    starts_at: string;
    ends_at: string | null;
    max_attempts: number | null;
    participant_count: number;
    channel_id: number;
    active: boolean;
    has_password: boolean;
    queue_mode: string;
    auto_skip: boolean;
    current_playlist_item: {
        id: number;
        room_id: number;
        beatmap_id: number;
        ruleset_id: number;
        allowed_mods: any[];
        required_mods: {
            acronym: string;
            settings: Record<string, unknown>;
        }[];
        expired: boolean;
        owner_id: number;
        playlist_order: number | null;
        played_at: string | null;
        beatmap: {
            beatmapset_id: number;
            difficulty_rating: number;
            id: number;
            mode: string;
            status: string;
            total_length: number;
            user_id: number;
            version: string;
            beatmapset: {
                artist: string;
                artist_unicode: string;
                covers: {
                    cover: string;
                    cover2x: string;
                    card: string;
                    card2x: string;
                    list: string;
                    list2x: string;
                    slimcover: string;
                    slimcover2x: string;
                };
                creator: string;
                favourite_count: number;
                hype: number | null;
                id: number;
                nsfw: boolean;
                offset: number;
                play_count: number;
                preview_url: string;
                source: string;
                spotlight: boolean;
                status: string;
                title: string;
                title_unicode: string;
                track_id: number | null;
                user_id: number;
                video: boolean;
            };
        };
    };
    difficulty_range: {
        max: number;
        min: number;
    };
    host: {
        avatar_url: string;
        country_code: string;
        default_group: string;
        id: number;
        is_active: boolean;
        is_bot: boolean;
        is_deleted: boolean;
        is_online: boolean;
        is_supporter: boolean;
        last_visit: string;
        pm_friends_only: boolean;
        profile_colour: string | null;
        username: string;
        country: {
            code: string;
            name: string;
        };
    };
    playlist_item_stats: {
        count_active: number;
        count_total: number;
        ruleset_ids: number[];
    };
    recent_participants: {
        avatar_url: string;
        country_code: string;
        default_group: string;
        id: number;
        is_active: boolean;
        is_bot: boolean;
        is_deleted: boolean;
        is_online: boolean;
        is_supporter: boolean;
        last_visit: string;
        pm_friends_only: boolean;
        profile_colour: string | null;
        username: string;
    }[];
};
/// GENERATED ///

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

async function getAccessToken(slack_id: string): Promise<string> {
    const user = await sql`SELECT * FROM links WHERE slack_id = ${slack_id}`;

    const data = await fetch("https://osu.ppy.sh/oauth/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: `client_id=33126&client_secret=${encodeURIComponent(process.env.CLIENT_SECRET!)}&grant_type=refresh_token&refresh_token=${user[0].refresh_token}&scope=public`
    }).then(res => res.json());

    sql`UPDATE links SET refresh_token = ${data.refresh_token} WHERE slack_id = ${slack_id}`;

    return data.access_token;
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

const multiplayerRoundCache: Room[] = [];

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
                osu: user.statistics_rulesets.osu?.total_score || 0,
                taiko: user.statistics_rulesets.taiko?.total_score || 0,
                fruits: user.statistics_rulesets.fruits?.total_score || 0,
                mania: user.statistics_rulesets.mania?.total_score || 0,
            }
        })))
    }

    cache.length = 0;

    cache.push(...lb);

    // Multiplayer games

    multiplayerRoundCache.length = 0;

    const rooms = await fetch(`https://osu.ppy.sh/api/v2/rooms?category=realtime`, {
        headers: {
            'Authorization': `Bearer ${await getAccessToken("U06TBP41C3E")}`
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

    const ownedRoom = multiplayerRoundCache.find(room => room.host.id == me.id);

    if (!me) {
        return ctx.respond({
            response_type: 'ephemeral',
            text: `Hey <@${ctx.context.userId}>, you aren't in a multiplayer room. If you are, make sure you're the host of the room, and you're on osu!lazer.`,
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `Hey <@${ctx.context.userId}>, you aren't in a multiplayer room. If you are, make sure you're the host of the room, and you're on osu!lazer.`,
                    }
                }
            ]
        });
    }    
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
            <pubDate>${new Date(post.published_at).toLocaleString('en-GB', {timeZone: 'UTC',hour12: false,weekday: 'short',year: 'numeric',month: 'short',day: '2-digit',hour: '2-digit',minute: '2-digit',second: '2-digit',}).replace(/(?:(\d),)/, '$1') + ' GMT'}</pubDate>
            <description>${post.preview}</description>
            <enclosure url="${post.first_image}" type="image/jpg"/>
        </item>`
        ).join('\n        ')}
    </channel>
</rss>`;

    res.contentType("application/rss+xml")
    res.send(out)
})

receiver.router.get('*', (req, res) => {
    res.redirect(`https://osu.ppy.sh${req.path}`)
})

    ; (async () => {
        await app.start(41691);

        console.log('⚡️ Bolt app is running!');

        cacheStuff();

        setTimeout(cacheStuff, 60 * 1000) // Cache every minute. Ratelimit is 1200 req/m anyways.
    })();