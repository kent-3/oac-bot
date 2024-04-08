import { randomInt } from 'crypto'
import { SecretNetworkClient } from 'secretjs'
import { Markup, Telegraf } from 'telegraf'
import 'dotenv/config'
import { initDb, addUser, getUsers } from './database.js'

const BOT_TOKEN = process.env.BOT_TOKEN
const PRIVATE_CHAT_ID = process.env.PRIVATE_CHAT_ID
const LCD_URL = process.env.LCD_URL
const CHAIN_ID = process.env.CHAIN_ID

const secretjs = new SecretNetworkClient({
  url: LCD_URL,
  chainId: CHAIN_ID,
})

const db = await initDb()

const bot = new Telegraf(BOT_TOKEN)

bot.telegram.setMyCommands([
  { command: 'start', description: 'Be greeted by the bot' },
  { command: 'join', description: 'Request an invitation' },
  { command: 'code', description: 'Get your OAC code' },
  { command: 'stake', description: 'Get SCRT staked to AmberDAO' },
  {
    command: 'delegators',
    description: 'Get number of delegators to AmberDAO',
  },
  {
    command: 'top5whale',
    description: 'Get top 5 largest delegations to AmberDAO',
  },
  { command: 'fact', description: 'Get a random fact about amber' },
])

const keyboard = Markup.keyboard([
  [
    Markup.button.webApp('amber.money', 'https://amber.money'),
    Markup.button.webApp('App Preview', 'https://kent-3.github.io/amber-app'),
  ],
]).resize()

bot.start((ctx) => {
  ctx.replyWithMarkdownV2(
    `Enter your SCRT address and AMBER viewing key to generate an invite link to OAC\\.

Example:
\`/join secret1s09x2xvfd2lp2skgzm29w2xtena7s8fq98v852 9a00ca4ad505e9be7e6e6dddf8d939b7ec7e9ac8e109c8681f10db9cacb36d42\``,
    keyboard
  )
})

bot.command('code', async (ctx) => {
  const text = ctx.message.text
  const [_command, address, viewingKey] = text.split(' ')
  let code

  if (ctx.chat.id < 0) {
    return ctx.reply('DM me')
  }

  if (!address || !viewingKey) {
    return ctx.reply(
      'Please provide an address and viewing key. Like this: `/code secret1s09x2xvfd2lp2skgzm29w2xtena7s8fq98v852 9a00ca4ad505e9be7e6e6dddf8d939b7ec7e9ac8e109c8681f10db9cacb36d42`'
    )
  }

  try {
    const response = await secretjs.query.compute.queryContract({
      contract_address: 'secret1s09x2xvfd2lp2skgzm29w2xtena7s8fq98v852',
      code_hash:
        '9a00ca4ad505e9be7e6e6dddf8d939b7ec7e9ac8e109c8681f10db9cacb36d42',
      query: {
        member_code: {
          address: address,
          key: viewingKey,
        },
      },
    })
    console.log(response)
    code = response.member_code.code
  } catch (error) {
    return ctx.reply(
      "I couldn't check your balance 😢. Check your address and viewing key, and try again."
    )
  }

  if (code === '') {
    return ctx.reply('Not enough AMBER...')
  } else {
    return ctx.reply(`Your OAC membership code is: ${code}`)
  }
})

bot.command('insert_user', async (ctx) => {
  const id = ctx.from.id
  const username = ctx.from.username
  const code = ctx.message.text.split(' ')[1]

  await addUser(db, { id, username, code })

  ctx.reply('OK')
})

bot.command('join', async (ctx) => {
  if (ctx.chat.id < 0) {
    return ctx.reply('DM me')
  }
  const text = ctx.message.text
  const [_command, address, viewingKey] = text.split(' ')
  if (!address || !viewingKey) {
    return ctx.reply(
      'Please provide an address and viewing key. Like this: `/join secret1s09x2xvfd2lp2skgzm29w2xtena7s8fq98v852 9a00ca4ad505e9be7e6e6dddf8d939b7ec7e9ac8e109c8681f10db9cacb36d42`'
    )
  }
  let amount = '0'
  try {
    const response = await secretjs.query.snip20.getBalance({
      contract: {
        address: 'secret1s09x2xvfd2lp2skgzm29w2xtena7s8fq98v852',
        code_hash:
          '9a00ca4ad505e9be7e6e6dddf8d939b7ec7e9ac8e109c8681f10db9cacb36d42',
      },
      address: address,
      auth: {
        key: viewingKey,
      },
    })
    console.log(response)
    amount = response.balance.amount
  } catch (error) {
    return ctx.reply(
      "I couldn't check your balance 😢. Check your address and viewing key, and try again."
    )
  }
  if (parseInt(amount) < 1000000) {
    ctx.reply('Not enough AMBER...')
  } else if (parseInt(amount) >= 1000000) {
    const userId = ctx.from.id
    try {
      const inviteLink = await ctx.telegram.exportChatInviteLink(
        PRIVATE_CHAT_ID
      )
      await ctx.telegram.sendMessage(
        userId,
        `Your request has been approved. Join the chat using this link: ${inviteLink}`
      )
    } catch (error) {
      console.log('Error generating invite link:', error)
    }
  }
})

bot.command('stake', async (ctx) => {
  const { validator: response } = await secretjs.query.staking.validator({
    validator_addr: 'secretvaloper18w7rm926ue3nmy8ay58e3lc2nqnttrlhhgpch6',
  })
  let scrt = Math.round(parseInt(response.tokens) / 1000000)
  ctx.reply(`AmberDAO has ${scrt.toLocaleString()} SCRT staked.`)
})

bot.command('delegators', async (ctx) => {
  const response = await secretjs.query.staking.validatorDelegations({
    validator_addr: 'secretvaloper18w7rm926ue3nmy8ay58e3lc2nqnttrlhhgpch6',
    pagination: { count_total: true },
  })
  let total = parseFloat(response.pagination.total)
  ctx.reply(`AmberDAO has ${total} delegations.`)
})

bot.command('top5whale', async (ctx) => {
  const { delegation_responses: response } =
    await secretjs.query.staking.validatorDelegations({
      validator_addr: 'secretvaloper18w7rm926ue3nmy8ay58e3lc2nqnttrlhhgpch6',
      pagination: { limit: '1000000' },
    })
  let amounts = []
  for (let i = 0; i < response.length; i++) {
    amounts.push(parseInt(response[i].balance?.amount))
  }
  amounts.sort((a, b) => a - b).reverse()
  let top_five = []
  for (let i = 0; i < 5; i++) {
    const element = Math.round(amounts[i] / 1000000)
    top_five.push(element.toLocaleString() + ' SCRT')
  }
  ctx.reply(
    `The top 5 largest delegations to AmberDAO are:\n${top_five.join(' \n')}`
  )
})

bot.command('fact', (ctx) => {
  let fact
  let facts = [
    'Amber is a gem - but not a gemstone. OK technically it is an "organic gemstone".',
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
  ]
  fact = facts[randomInt(11)]
  ctx.reply(fact)
})

bot.launch()

console.log('Bot is running...')

process.once('SIGINT', () => {
  console.log('Bot is interupted...')
  bot.stop('SIGINT')
})

process.once('SIGTERM', () => {
  console.log('Bot is shutting down...')
  bot.stop('SIGTERM')
})
