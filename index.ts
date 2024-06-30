Bun.serve({
    port: 41691,
    async fetch(req: Request) {
        if (req.method == "OPTIONS") {
            return new Response(null)
        }
        const url = new URL(req.url, "https://loc.al/");

        if (url.pathname == "/callback") {
            const code = url.searchParams.get("code");

            const data = await fetch("https://osu.ppy.sh/oauth/token", {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                body: `client_id=33126&client_secret=${encodeURIComponent(Bun.env.CLIENT_SECRET!)}&code=${code}&grant_type=authorization_code&redirect_uri=${encodeURIComponent("https://osu.haroon.hackclub.app/callback")}`
            }).then(res => res.json());

            if (data.error) {
                console.log(data)
                return new Response(`Something went wrong: \n\n${data.message} (${data.error})\n\nThis has been reported.`)
            } else {
                const user = await fetch("https://osu.ppy.sh/api/v2/me", {
                    headers: {
                        "Authorization": `Bearer ${data.access_token}`
                    }
                }).then(res => res.json());

                return new Response(`Hello, ${user.username}!`)
            }
        }

        return new Response(null, { status: 404 });
    }
})