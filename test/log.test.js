import test from 'node:test'
import assert from 'node:assert/strict'
import { createLogger, maskText } from '../src/log.js'

const ENV = { DSH_HOME: 'F:\\demo\\.dsh', DSH_PROFILE_DIR: 'F:\\demo\\.dsh\\profiles\\desktop', DSH_PROFILE: 'desktop' }

test('日志脱敏：本机路径变成占位符', () => {
  const masked = maskText(`写到了 ${ENV.DSH_PROFILE_DIR}\\package.json 与 ${ENV.DSH_HOME}\\skills`, ENV)
  assert.ok(masked.includes('<PROFILE_DIR>'))
  assert.ok(masked.includes('<DSH_HOME>'))
  assert.equal(masked.includes('F:\\demo'), false)
})

test('日志脱敏：疑似密钥一律替换，绝不落盘', () => {
  assert.ok(maskText('apiKey=sk-abcdefghijklmnopqrstuvwx').includes('<REDACTED>'))
  assert.ok(maskText('Authorization: Bearer abcdefghijklmnop').includes('<REDACTED>'))
  assert.ok(maskText('https://user:pass@example.com/x').includes('<REDACTED>'))
})

test('createLogger：宿主 logger 缺失时退回 console，并且不抛错', () => {
  const logger = createLogger({})
  assert.equal(typeof logger.info, 'function')
  assert.doesNotThrow(() => logger.info('普通信息'))
  assert.doesNotThrow(() => logger.warn('警告'))
  assert.doesNotThrow(() => logger.error('错误'))
})

test('createLogger：优先用宿主 logger；once 只出一次', () => {
  const seen = []
  const ctx = { logger: name => ({ info: message => seen.push([name, message]), warn: () => {} }) }
  const logger = createLogger(ctx)
  logger.info('hello')
  logger.once('k', 'warn', '一次')
  logger.once('k', 'warn', '一次')
  assert.deepEqual(seen[0], ['brittle-backup', 'hello'])
  assert.equal(logger.constructor.name, 'Object')
})

test('createLogger：宿主 logger 抛错也不影响调用方', () => {
  const ctx = { logger: () => ({ info: () => { throw new Error('宿主 logger 坏了') } }) }
  const logger = createLogger(ctx)
  assert.doesNotThrow(() => logger.info('x'))
})
