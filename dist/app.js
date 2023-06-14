import fetch from 'node-fetch';
import { SecretNetworkClient } from 'secretjs';
import { Markup, Telegraf } from 'telegraf';
import 'dotenv/config';
const BOT_TOKEN = process.env.BOT_TOKEN;
const PRIVATE_CHAT_ID = process.env.PRIVATE_CHAT_ID;
const LCD_URL = process.env.LCD_URL;
const CHAIN_ID = process.env.CHAIN_ID;
const secretjs = new SecretNetworkClient({
    url: LCD_URL,
    chainId: CHAIN_ID,
});
let cache = [];
let lastFetchTime = new Date(0); // initialize to some time in the past
const fetchUrl = process.env.SHADESWAP_API;
async function fetchAndCacheData() {
    const now = new Date();
    const timeDiff = (now.getTime() - lastFetchTime.getTime()) / 1000; // time difference in seconds
    if (timeDiff > 5 * 60 || cache.length === 0) {
        // if it's been over 5 minutes or the cache is empty
        console.log('Fetching and Caching...');
        const response = await fetch(fetchUrl);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = (await response.json());
        cache = data; // update the cache
        lastFetchTime = now; // update the fetch time
        console.log('lastFetchTime: ', lastFetchTime);
    }
    return cache;
}
function search(data, name) {
    const lowerCaseName = name.toLowerCase().trim();
    return data.filter((item) => item.name.toLowerCase().trim().includes(lowerCaseName) && !item.name.endsWith('LP'));
    // const foundObject = data.find((item) => item.name === name);
    // return foundObject ? foundObject.value : undefined;
}
function format(str) {
    if (str === undefined) {
        return null;
    }
    const num = parseFloat(str);
    return `${num.toFixed(2)} USD`;
}
const bot = new Telegraf(BOT_TOKEN);
const keyboard = Markup.keyboard([
    [
        Markup.button.webApp('amberdao.io', 'https://www.amberdao.io/'),
        Markup.button.webApp('App Preview', 'https://kent-3.github.io/amber-app'),
    ],
]).resize();
bot.start((ctx) => {
    ctx.replyWithMarkdownV2(`Enter your Secret address and viewing key to generate an invite link to OAC\\.

Example:
\`/join secret1hctvs6s48yu7pr2n3ujn3wn74fr5d798daqwwg amber_rocks\``, keyboard);
});
bot.telegram.setMyCommands([
    { command: 'start', description: 'Be greeted by the bot' },
    {
        command: 'join',
        description: 'Request an invitation',
    },
    { command: 'p', description: 'Get price of a token' },
    { command: 'ratio', description: 'Get ratio of SHD/SCRT' },
]);
bot.on('inline_query', async (ctx) => {
    const query = ctx.inlineQuery.query ?? '';
    const results = [];
    const data = await fetchAndCacheData();
    const assets = search(data, query);
    if (query == 'ratio') {
        const SHD = data.find((item) => item.name === 'SHD');
        const SCRT = data.find((item) => item.name === 'SCRT');
        const stkdSCRT = data.find((item) => item.name === 'stkd-SCRT');
        const ratio1 = (parseFloat(SHD.value) / parseFloat(SCRT.value)).toFixed(2);
        const ratio2 = (parseFloat(SHD.value) / parseFloat(stkdSCRT.value)).toFixed(2);
        // ctx.reply(`1 SHD = ${ratio1} SCRT`);
        // ctx.reply(`1 SHD = ${ratio2} stkd-SCRT`);
        const result1 = {
            type: 'article',
            id: '1',
            title: `1 SHD = ${ratio1} SCRT`,
            input_message_content: {
                message_text: `1 SHD = ${ratio1} SCRT`,
            },
        };
        const result2 = {
            type: 'article',
            id: '2',
            title: `1 SHD = ${ratio2} stkd-SCRT`,
            input_message_content: {
                message_text: `1 SHD = ${ratio2} stkd-SCRT`,
            },
        };
        results.push(result1, result2);
    }
    else if (query != 'ratio' && assets) {
        assets.sort((a, b) => a.name.localeCompare(b.name));
        for (const [i, asset] of assets.entries()) {
            const title = `${asset.name} = ${format(asset.value)}`;
            const result = {
                type: 'article',
                id: i.toString(),
                title: title,
                input_message_content: {
                    message_text: title,
                },
            };
            results.push(result);
        }
    }
    else {
        const result = {
            type: 'article',
            id: '1',
            title: 'Not Found',
            input_message_content: {
                message_text: '',
            },
        };
        results.push(result);
    }
    // const inlineQueryResultsButton = {
    //   text: 'Launch ShadeSwap',
    //   web_app: {
    //     url: 'https://app.shadeprotocol.io/swap'
    //   }
    // };
    ctx.answerInlineQuery(results, {
        cache_time: 300,
    });
});
// bot.command('p', async (ctx) => {
// 	const text = ctx.message.text;
// 	const [command, query] = text.split(' ');
// 	const data = await fetchAndCacheData();
// 	const assets = search(data, query);
// 	if (assets) {
// 		const title = `${assets[0].name} = ${format(assets[0].value)}`;
// 		ctx.reply(title);
// 	} else {
// 		ctx.reply(`${query} not found`);
// 	}
// });
bot.command('ratio', async (ctx) => {
    const data = await fetchAndCacheData();
    const SHD = data.find((item) => item.name === 'SHD');
    const SCRT = data.find((item) => item.name === 'SCRT');
    const stkdSCRT = data.find((item) => item.name === 'stkd-SCRT');
    const ratio1 = (parseFloat(SHD.value) / parseFloat(SCRT.value)).toFixed(2);
    const ratio2 = (parseFloat(SHD.value) / parseFloat(stkdSCRT.value)).toFixed(2);
    ctx.reply(`1 SHD = ${ratio1} SCRT\n1 SHD = ${ratio2} stkd-SCRT`);
    // ctx.reply(`1 SHD = ${ratio2} stkd-SCRT`);
});
bot.command('join', async (ctx) => {
    const text = ctx.message.text;
    const [command, address, viewingKey] = text.split(' ');
    if (!address || !viewingKey) {
        return ctx.reply('Please provide a address and viewingKey. Usage: /join <address> <viewingKey>');
    }
    let amount = '0';
    try {
        const response = await secretjs.query.snip20.getBalance({
            contract: {
                address: 'secret1s09x2xvfd2lp2skgzm29w2xtena7s8fq98v852',
                code_hash: '5a085bd8ed89de92b35134ddd12505a602c7759ea25fb5c089ba03c8535b3042',
            },
            address: address,
            auth: {
                key: viewingKey,
            },
        });
        amount = response.balance.amount;
    }
    catch (error) {
        return ctx.reply("I couldn't check your balance 😢. Check your address and viewing key, and try again.");
    }
    if (parseFloat(amount) < 1) {
        ctx.reply('Not enough AMBER...');
    }
    else if (parseFloat(amount) >= 1) {
        const userId = ctx.from.id;
        try {
            const inviteLink = await ctx.telegram.exportChatInviteLink(PRIVATE_CHAT_ID);
            await ctx.telegram.sendMessage(userId, `Your request has been approved. Join the chat using this link: ${inviteLink}`);
        }
        catch (error) {
            console.log('Error generating invite link:', error);
        }
    }
});
bot.launch();
console.log('Bot is running...');
process.once('SIGINT', () => {
    console.log('Bot is interupted...');
    bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    console.log('Bot is shutting down...');
    bot.stop('SIGTERM');
});
//# sourceMappingURL=app.js.map