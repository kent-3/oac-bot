import { Telegraf } from 'telegraf'
import { SecretNetworkClient } from 'secretjs'
import 'dotenv/config'

const BOT_TOKEN = process.env.BOT_TOKEN
const PRIVATE_CHAT_ID = process.env.PRIVATE_CHAT_ID

const bot = new Telegraf(BOT_TOKEN)

/**
 * Retrieves all users from the database.
 * @param {import('sqlite').Database} db - The database connection.
 * @returns {Promise<Array>} A promise that resolves with an array of codes.
 */
async function getAllMemberCodes(db) {
  const rows = await db.all('SELECT code FROM users ORDER BY date ASC')
  const codes = rows.map((row) => row.code)
  return codes
}

/**
 * @param {SecretNetworkClient} secretjs - A Secret Network client.
 * @param {string[]} codes - An array of codes.
 * @returns {Promise<string[]>} An array of codes that are valid.
 */
async function validateCodes(secretjs, codes) {
  const response = await secretjs.query.compute.queryContract({
    contract_address: 'secret1s09x2xvfd2lp2skgzm29w2xtena7s8fq98v852',
    code_hash:
      '9a00ca4ad505e9be7e6e6dddf8d939b7ec7e9ac8e109c8681f10db9cacb36d42',
    query: {
      valid_codes: {
	  codes: codes,
      },
    },
  })
  return response.valid_codes.codes
}

/**
 * @param {import('telegraf').Context} ctx - Telegraf bot context.
 * @returns {Promise<void>} Will error if exporting invite link or sending message fails.
 */
async function sendInviteLink(ctx, chatId) {
  try {
    const userId = ctx.from.id
    const inviteLink = await ctx.telegram.exportChatInviteLink(chatId)
    await ctx.telegram.sendMessage(
      userId,
      `Your request has been approved. Join the chat using this link: ${inviteLink}`
    )
  } catch (error) {
    console.error('Error sending invite link:', error)
    throw error
  }
}

/**
 * @param {import('sqlite').Database} db - The database connection.
 * @param {string[]} validCodes - An array of valid codes.
 * @returns {Promise<Array>} An array of users that need to be kicked.
 */
async function findMembersToKick(db, validCodes) {
  const placeholders = validCodes.map(() => '?').join(', ')
  const query = `SELECT * FROM users WHERE code NOT IN (${placeholders})`
  const rows = await db.all(query, validCodes)
  const ids = rows.map((row) => row.id)

  return ids
}

/**
 * @param {number} bozo - A Telegram user ID.
 * @returns {Promise<void>}
 */
async function rip(bozo) {
  try {
    // Lookup the chat member's current name
    const chatMember = await bot.telegram.getChatMember(PRIVATE_CHAT_ID, bozo)

    // Unbanning a chat member who is not banned will remove them from the chat,
    // unless `only_if_banned: true`
    // await bot.telegram.unbanChatMember(PRIVATE_CHAT_ID, bozo, {
    //   only_if_banned: true,
    // })
    //
    // await bot.telegram.sendMessage(
    //   PRIVATE_CHAT_ID,
    //   `RIP ${chatMember.user.first_name}`
    // )
    console.log(`RIP ${chatMember.user.first_name}`)
  } catch (e) {
    console.error(e)
  }
}

export { getAllMemberCodes, validateCodes, sendInviteLink, findMembersToKick, rip }
