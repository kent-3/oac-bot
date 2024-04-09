import { SecretNetworkClient } from 'secretjs'
import { initDb, addUser, getUsers } from './database.js'
import {
  getAllMemberCodes,
  validateCodes,
  findMembersToKick,
  rip,
} from './utils.js'
import 'dotenv/config'

const LCD_URL = process.env.LCD_URL
const CHAIN_ID = process.env.CHAIN_ID

const secretjs = new SecretNetworkClient({
  url: LCD_URL,
  chainId: CHAIN_ID,
})

console.info('Opening database...')
const db = await initDb()
console.log(db.config.filename)

console.info('Getting codes from database...')
const codes = await getAllMemberCodes(db)
console.log(codes)

console.info('Querying contract for valid codes...')
const validCodes = await validateCodes(secretjs, codes)
console.log(validCodes)

console.info('Getting IDs from database...')
const bozos = await findMembersToKick(db, validCodes)
console.log(bozos)

for (const bozo of bozos) {
  await rip(bozo)
}
