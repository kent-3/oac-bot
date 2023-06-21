import fetch from 'node-fetch';
import { randomInt } from 'crypto';
import { createCanvas, registerFont } from 'canvas';
import { SecretNetworkClient } from 'secretjs';
import { Markup, Telegraf } from 'telegraf';
import { InlineQueryResultArticle } from 'telegraf/typings/core/types/typegram';
import 'dotenv/config';
import { getTotalUnbonding } from './unbonding.js';
import { createChart } from './charting.js';
import fs from 'fs';
import { promisify } from 'util';
import path from 'path';

// Convert fs functions to promises
const stat = promisify(fs.stat);
const exists = promisify(fs.exists);

registerFont('./fonts/OpenSans-Regular.ttf', { family: 'Open Sans' });

const drawColoredCube = (percentage: number, height: string, gas: string): Buffer => {
	// First, we'll map the percentage to a color.
	// Here, we'll use a simple gradient from red (0%) to green (100%).
	// const r = Math.floor(255 * ((100 - percentage) / 100));
	// const g = Math.floor(255 * (percentage / 100));
	const a = 0.3 + (0.7 * percentage) / 100;

	const canvas = createCanvas(200, 200);
	const ctx = canvas.getContext('2d');

	// Set entire canvas
	// ctx.fillStyle = `rgb(75, 77, 78)`;
	// ctx.fillRect(0, 0, canvas.width, canvas.height);

	// Write your data on the canvas
	ctx.fillStyle = `rgb(0, 0, 0)`;
	ctx.font = '18px "Open Sans"';
	ctx.fillText(`gas used: ${gas}`, 15, 180);
	ctx.fillText(`block: ${height}`, 30, 30);

	// Draw a square to represent the cube
	ctx.strokeStyle = 'black';
	ctx.lineWidth = 2;
	ctx.strokeRect(50, 50, 100, 100);

	// Calculate the height of the filled area
	const fillHeight = 98 * (percentage / 100);
	const startY = 149 - fillHeight; // We start from the bottom of the square

	// Fill the square with the color
	// ctx.fillStyle = `rgb(${r}, ${g}, 10)`;
	ctx.fillStyle = `rgba(242, 176, 70, ${a})`;
	ctx.fillRect(51, startY, 98, fillHeight);

	// ctx.fillRect(51, 51, 99, 99); // Fill the inside of the square completely

	return canvas.toBuffer();
};

const BOT_TOKEN = process.env.BOT_TOKEN!;
const PRIVATE_CHAT_ID = process.env.PRIVATE_CHAT_ID!;
const LCD_URL = process.env.LCD_URL!;
const CHAIN_ID = process.env.CHAIN_ID!;

const secretjs = new SecretNetworkClient({
	url: LCD_URL,
	chainId: CHAIN_ID,
});

type TokenInfo = {
	id: string;
	name: string;
	value: string;
	price_24hr_change: string;
};

let cache: TokenInfo[] = [];
let lastFetchTime: Date = new Date(0); // initialize to some time in the past
const fetchUrl = process.env.SHADESWAP_API!;

async function fetchAndCacheData(): Promise<TokenInfo[]> {
	const now = new Date();
	const timeDiff = (now.getTime() - lastFetchTime.getTime()) / 1000; // time difference in seconds

	if (timeDiff > 5 * 60 || cache.length === 0) {
		// if it's been over 5 minutes or the cache is empty
		console.log('Fetching and Caching...');

		const response = await fetch(fetchUrl);

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const data = (await response.json()) as TokenInfo[];
		cache = data; // update the cache
		lastFetchTime = now; // update the fetch time
		console.log('lastFetchTime: ', lastFetchTime);
	}

	return cache;
}

function search(data: TokenInfo[], name: string): TokenInfo[] | undefined {
	const lowerCaseName = name.toLowerCase().trim();
	return data.filter(
		(item) => item.name.toLowerCase().trim().includes(lowerCaseName) && !item.name.endsWith('LP')
	);
}

function format(str: string | undefined): string | null {
	if (str === undefined) {
		return null;
	}

	const num = parseFloat(str);
	return `${num.toFixed(3)} USD`;
}

const bot = new Telegraf(BOT_TOKEN);

const keyboard = Markup.keyboard([
	[
		Markup.button.webApp('amberdao.io', 'https://www.amberdao.io/'),
		Markup.button.webApp('App Preview', 'https://kent-3.github.io/amber-app'),
	],
]).resize();

bot.start((ctx) => {
	ctx.replyWithMarkdownV2(
		`Enter your SCRT address and AMBER viewing key to generate an invite link to OAC\\.

Example:
\`/join secret1hctvs6s48yu7pr2n3ujn3wn74fr5d798daqwwg amber_rocks\``,
		keyboard
	);
});

bot.telegram.setMyCommands([
	{ command: 'start', description: 'Be greeted by the bot' },
	{
		command: 'join',
		description: 'Request an invitation',
	},
	// { command: 'p', description: 'Get price of a token' },
	{ command: 'ratio', description: 'Get ratio of SHD/SCRT' },
	{ command: 'stake', description: 'Get SCRT staked to AmberDAO' },
	{ command: 'delegators', description: 'Get number of delegators to AmberDAO' },
	{ command: 'top5whale', description: 'Get top 5 largest delegations to AmberDAO' },
	{ command: 'fact', description: 'Get a random fact about amber' },
]);

bot.on('inline_query', async (ctx) => {
	const query = ctx.inlineQuery.query ?? '';
	const results: InlineQueryResultArticle[] = [];

	const data = await fetchAndCacheData();
	const assets = search(data, query);

	if (query == 'ratio') {
		const SHD = data.find((item) => item.name === 'SHD');
		const SCRT = data.find((item) => item.name === 'SCRT');
		const stkdSCRT = data.find((item) => item.name === 'stkd-SCRT');
		const ratio1 = (parseFloat(SHD!.value) / parseFloat(SCRT!.value)).toFixed(2);
		const ratio2 = (parseFloat(SHD!.value) / parseFloat(stkdSCRT!.value)).toFixed(2);
		// ctx.reply(`1 SHD = ${ratio1} SCRT`);
		// ctx.reply(`1 SHD = ${ratio2} stkd-SCRT`);
		const result1: InlineQueryResultArticle = {
			type: 'article',
			id: '1',
			title: `1 SHD = ${ratio1} SCRT`,
			input_message_content: {
				message_text: `1 SHD = ${ratio1} SCRT`,
			},
		};
		const result2: InlineQueryResultArticle = {
			type: 'article',
			id: '2',
			title: `1 SHD = ${ratio2} stkd-SCRT`,
			input_message_content: {
				message_text: `1 SHD = ${ratio2} stkd-SCRT`,
			},
		};
		results.push(result1, result2);
	} else if (query != 'ratio' && assets) {
		assets.sort((a, b) => a.name.localeCompare(b.name));
		for (const [i, asset] of assets.entries()) {
			const title = `${asset.name} = ${format(asset.value)}`;

			const result: InlineQueryResultArticle = {
				type: 'article',
				id: i.toString(),
				title: title,
				input_message_content: {
					message_text: title,
				},
			};
			results.push(result);
		}
	} else {
		const result: InlineQueryResultArticle = {
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
	const ratio1 = (parseFloat(SHD!.value) / parseFloat(SCRT!.value)).toFixed(2);
	const ratio2 = (parseFloat(SHD!.value) / parseFloat(stkdSCRT!.value)).toFixed(2);
	ctx.reply(`1 SHD = ${ratio1} SCRT\n1 SHD = ${ratio2} stkd-SCRT`);
});

bot.command('join', async (ctx) => {
	if (ctx.chat.id < 0) {
		// bot doesn't have permission to delete messages yet
		// if (ctx.chat.id == -1001742085729) {
		// 	ctx.deleteMessage(ctx.message.message_id);
		// }
		return ctx.reply('DM me');
	}

	const text = ctx.message.text;
	const [command, address, viewingKey] = text.split(' ');

	if (!address || !viewingKey) {
		return ctx.reply('Please provide an address and viewing key. Usage: /join <address> <key>');
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
	} catch (error) {
		return ctx.reply(
			"I couldn't check your balance 😢. Check your address and viewing key, and try again."
		);
	}

	if (parseFloat(amount) < 1) {
		ctx.reply('Not enough AMBER...');
	} else if (parseFloat(amount) >= 1) {
		const userId = ctx.from.id;
		try {
			const inviteLink = await ctx.telegram.exportChatInviteLink(PRIVATE_CHAT_ID);
			await ctx.telegram.sendMessage(
				userId,
				`Your request has been approved. Join the chat using this link: ${inviteLink}`
			);
		} catch (error) {
			console.log('Error generating invite link:', error);
		}
	}
});

bot.command('stake', async (ctx) => {
	const { validator: response } = await secretjs.query.staking.validator({
		validator_addr: 'secretvaloper18w7rm926ue3nmy8ay58e3lc2nqnttrlhhgpch6',
	});
	let scrt = Math.round(parseInt(response!.tokens!) / 1000000);
	ctx.reply(`AmberDAO has ${scrt.toLocaleString()} SCRT staked.`);
});
bot.command('delegators', async (ctx) => {
	const response = await secretjs.query.staking.validatorDelegations({
		validator_addr: 'secretvaloper18w7rm926ue3nmy8ay58e3lc2nqnttrlhhgpch6',
		pagination: { count_total: true },
	});
	let total: number = parseFloat(response.pagination!.total!);
	ctx.reply(`AmberDAO has ${total} delegations.`);
});
bot.command('top5whale', async (ctx) => {
	const { delegation_responses: response } = await secretjs.query.staking.validatorDelegations({
		validator_addr: 'secretvaloper18w7rm926ue3nmy8ay58e3lc2nqnttrlhhgpch6',
		pagination: { limit: '1000000' },
	});
	let amounts: number[] = [];
	for (let i = 0; i < response!.length; i++) {
		amounts.push(parseInt(response![i].balance?.amount!));
	}
	amounts.sort((a, b) => a - b).reverse();
	let top_five: string[] = [];
	for (let i = 0; i < 5; i++) {
		const element = Math.round(amounts[i] / 1000000);
		top_five.push(element.toLocaleString() + ' SCRT');
	}
	ctx.reply(`The top 5 largest delegations to AmberDAO are:\n${top_five.join(' \n')}`);
});
bot.command('fact', (ctx) => {
	let fact: string;
	let facts: string[] = [
		'Amber is a gem - but not a gemstone.',
		'The largest amber deposits in the world are in the Baltic region.',
		"Amber was once part of a tree's immune system",
		'Amber requires millions of years and proper burial conditions to form.',
		'The word electricity derives from the greek word for amber.',
		'Multiple extinct species have been identified thanks to amber.',
		'Amber has healing powers and the power to ward off witches.',
		'Humans have used amber in jewelry since at least 11,000 BCE.',
		'The oldest amber is 320 million years old.',
		'Amber has been found in more than 300 colors.',
		"It's easy to be fooled by fake amber.",
	];
	fact = facts[randomInt(11)];
	ctx.reply(fact);
});

bot.command('block', async (ctx) => {
	const r = await secretjs.query.tendermint.getLatestBlock({});
	const blockHeight = r.block?.header?.height!;

	let gas = 0;

	try {
		const resp = await secretjs.query.txsQuery(`tx.height = ${blockHeight}`);

		resp.forEach((element) => {
			gas += element.gasUsed;
		});
	} catch (error) {
		throw new Error(`Error:\n ${JSON.stringify(error, null, 4)}`);
	}

	const imageBuffer = drawColoredCube(
		(100 * gas) / 6000000,
		parseInt(blockHeight!).toLocaleString(),
		gas.toLocaleString()
	);
	ctx.replyWithPhoto({ source: imageBuffer });
});

bot.command('unbonding', async (ctx) => {
	const filePath = 'unbonding.json';
	const fileExists = await exists(filePath);
	let shouldUpdateFile = true;

	if (fileExists) {
		const stats = await stat(filePath);
		const creationTime = new Date(stats.mtime);
		const currentTime = new Date();

		// Difference in milliseconds
		const difference = currentTime.getTime() - creationTime.getTime();

		// If the difference is less than 12 hours, we don't need to update the file
		if (difference < 12 * 60 * 60 * 1000) {
			shouldUpdateFile = false;
		}
	}
  let loadingMessage;

  if (shouldUpdateFile) {
    loadingMessage = await ctx.reply('Processing your request. This might take a while...');
    await getTotalUnbonding(); // I'm assuming this function updates 'unbonding.json'
  }

  const imageBuffer = await createChart('unbonding.json');
  if (loadingMessage) {
    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessage.message_id);
  }
	ctx.replyWithPhoto({ source: imageBuffer });
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
