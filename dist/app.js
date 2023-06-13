import { SecretNetworkClient } from "secretjs";
import { Telegraf } from "telegraf";
import "dotenv/config";
const BOT_TOKEN = process.env.BOT_TOKEN;
const PRIVATE_CHAT_ID = process.env.PRIVATE_CHAT_ID;
const LCD_URL = process.env.LCD_URL;
const CHAIN_ID = process.env.CHAIN_ID;
const secretjs = new SecretNetworkClient({
    url: LCD_URL,
    chainId: CHAIN_ID,
});
const bot = new Telegraf(BOT_TOKEN);
bot.start((ctx) => {
    ctx.replyWithMarkdownV2(`Enter your Secret address and viewing key to generate an invite link to OAC\\.

Example:
\`/join secret1hctvs6s48yu7pr2n3ujn3wn74fr5d798daqwwg amber_rocks\``);
});
bot.command("join", async (ctx) => {
    const text = ctx.message.text;
    const [command, address, viewingKey] = text.split(" ");
    if (!address || !viewingKey) {
        return ctx.reply("Please provide a address and viewingKey. Usage: /join <address> <viewingKey>");
    }
    let amount = "0";
    try {
        const response = await secretjs.query.snip20.getBalance({
            contract: {
                address: "secret1s09x2xvfd2lp2skgzm29w2xtena7s8fq98v852",
                code_hash: "5a085bd8ed89de92b35134ddd12505a602c7759ea25fb5c089ba03c8535b3042",
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
        ctx.reply("Not enough AMBER...");
    }
    else if (parseFloat(amount) >= 1) {
        const userId = ctx.from.id;
        try {
            const inviteLink = await ctx.telegram.exportChatInviteLink(PRIVATE_CHAT_ID);
            await ctx.telegram.sendMessage(userId, `Your request has been approved. Join the chat using this link: ${inviteLink}`);
        }
        catch (error) {
            console.log("Error generating invite link:", error);
        }
    }
});
bot.launch();
console.log("Bot is running...");
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
//# sourceMappingURL=app.js.map