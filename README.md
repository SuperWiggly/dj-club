# The Club

A 3D virtual club that runs in the browser. Viewers click a link in Twitch chat, log in with Twitch, and walk around a dance floor as a little avatar with their name over their head. The DJ (you) stands behind the booth, and your live Twitch stream plays on the big screen behind you.

- Walk with WASD / arrow keys, or tap the floor. Phones get an on-screen joystick.
- Drag to look around, scroll to zoom.
- Dances: Stand, Bounce, Spin, Sway, Jump (keys 1-5).
- Emotes float above your head: 🔥 ❤️ 🙌 😂 🎉 💯 👏 🕺 (keys Q E R T Y U I O).
- Up to 100 people at once (change with `MAX_PLAYERS`).
- When you log in with the Twitch account that matches `TWITCH_CHANNEL`, you appear behind the booth wearing headphones, with a red-outlined name.
- Only the DJ and people the DJ invites can stand on the stage.
- Behind the back wall is a green room / VIP lounge, through the door to the right of the screen. Only people the DJ lets in can enter.
- **DJ tools:** tap anyone to invite them on stage or into the green room (or take it back), or press **Crowd** for a searchable list of everyone. Access lasts until they leave.
- Look: dark Y2K / cyber sigilism. Everyone is black chrome for now; colors and effects are meant to be unlocked later.

## Settings

The server reads these settings (called environment variables):

| Setting | What it is | Example |
| --- | --- | --- |
| `TWITCH_CHANNEL` | Your Twitch channel name. Already set to `we_love_super`, so you can skip it | `we_love_super` |
| `TWITCH_CLIENT_ID` | From your Twitch app (step 1 below) | `abc123...` |
| `MAX_PLAYERS` | Room limit, default 100 | `100` |
| `ALLOW_GUESTS` | `true` lets people join without Twitch. Off by default once `TWITCH_CLIENT_ID` is set | `false` |
| `TEST_DJ_NAME` | Testing only: a guest with this name becomes the DJ. Leave empty when live | |

## Step 1: Make a Twitch app (5 minutes, free)

1. Go to https://dev.twitch.tv/console and log in with your Twitch account. Twitch may ask you to turn on two-factor authentication first.
2. Click **Register Your Application**.
3. Name: anything, for example `My DJ Club`.
4. OAuth Redirect URLs: add the address of your club with a `/` at the end, for example `https://my-dj-club.onrender.com/`. You can add `http://localhost:3000/` too for testing on your own computer.
5. Category: **Website Integration**. Client type: **Public**.
6. Click **Create**, then **Manage**, and copy the **Client ID**. You do not need a client secret.

## Step 2: Put it online (about $7 a month)

The easiest host is Render (https://render.com), which runs it straight from GitHub.

1. Put this folder in a GitHub repository.
2. On Render, click **New > Web Service** and pick the repository.
3. Runtime: **Node**. Build command: `npm install`. Start command: `npm start`.
4. Plan: **Starter** ($7/month). The free plan falls asleep when nobody is using it, which would make a raid wait almost a minute at the door.
5. Under **Environment**, add `TWITCH_CLIENT_ID`. Your channel (`we_love_super`) is already built in.
6. Deploy. Render gives you an address like `https://my-dj-club.onrender.com`. Make sure it matches the redirect URL in your Twitch app exactly (with the `/` at the end).

Railway (https://railway.app, about $5/month) and Fly.io also work the same way.

## Step 3: Share it

Post the link in your Twitch chat, or make a chat command like `!club` with Nightbot or StreamElements that replies with the link.

## Try it on your own computer

You need Node.js 18 or newer (https://nodejs.org).

```
npm install
TEST_DJ_NAME=dj npm start
```

Open http://localhost:3000 and join as a guest. Join with the name `dj` to stand behind the booth.

To see what a raid looks like, run this in a second window. It adds 60 fake viewers who wander and dance:

```
node test/bots.js 60
```

To check that the stage and green room rules hold (start the server with `TEST_DJ_NAME=dj` first):

```
node test/rules.js
```

## How it works

- `server.js` serves the web page and keeps track of everyone in the club. It checks each Twitch login with Twitch itself, so nobody can pretend to be you. It sends out positions 10 times a second, only for people who moved.
- `public/club.js` draws the club with Three.js and handles walking, dancing and emotes.
- The Twitch player is a real Twitch embed placed in 3D behind the booth, so it has the same few seconds of delay as watching on Twitch. Viewers tap **Tap for sound** to unmute, because browsers block sound until you click.
- The lights pulse at 124 BPM. They are not synced to your actual music yet.
