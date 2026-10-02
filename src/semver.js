/**
 * 极简 semver（peerDependencies 判定用，§7-#4 要求"含 prerelease"）。
 *
 * 支持：精确、`^`、`~`、`>=` `>` `<=` `<` `=`、`*`/空、用空格或逗号表示的 AND、
 * 用 `||` 表示的 OR、`a - b` 连字符范围、部分版本（`1`、`1.2`）。
 * prerelease 规则按 npm：**带 prerelease 的版本只有在同一 [major,minor,patch] 上
 * 有带 prerelease 的比较符时才算满足**（这正是"含 prerelease"要处理的部分）。
 */
export function parseVersion(text) {
  const matched = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(text ?? '').trim())
  if (!matched) return null
  return { major: Number(matched[1]), minor: Number(matched[2]), patch: Number(matched[3]), pre: matched[4] ?? '', raw: String(text).trim() }
}

function comparePre(a, b) {
  if (a === b) return 0
  if (a === '') return 1
  if (b === '') return -1
  const left = a.split('.')
  const right = b.split('.')
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const x = left[index]
    const y = right[index]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = /^\d+$/.test(x)
    const ny = /^\d+$/.test(y)
    if (nx && ny) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1
      continue
    }
    if (nx !== ny) return nx ? -1 : 1
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

export function compareVersions(a, b) {
  const left = typeof a === 'string' ? parseVersion(a) : a
  const right = typeof b === 'string' ? parseVersion(b) : b
  if (left === null || right === null) return 0
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  }
  return comparePre(left.pre, right.pre)
}

function upperForCaret(version) {
  if (version.major > 0) return { major: version.major + 1, minor: 0, patch: 0, pre: '' }
  if (version.minor > 0) return { major: 0, minor: version.minor + 1, patch: 0, pre: '' }
  return { major: 0, minor: 0, patch: version.patch + 1, pre: '' }
}

function upperForTilde(version, parts) {
  if (parts <= 1) return { major: version.major + 1, minor: 0, patch: 0, pre: '' }
  return { major: version.major, minor: version.minor + 1, patch: 0, pre: '' }
}

/** 解析单个比较符；返回 null 表示"任意"（`*`）。 */
function parseComparator(token) {
  const text = String(token).trim()
  if (text === '' || text === '*' || text === 'x' || text === 'X') return null
  const matched = /^(>=|<=|>|<|=|\^|~)?\s*v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?$/.exec(text)
  if (!matched) return { unsupported: true, raw: text }
  const operator = matched[1] ?? '='
  // 组 2/3/4 是 major/minor/patch，组 5 才是 prerelease。
  const major = matched[2]
  const minor = matched[3]
  const patch = matched[4]
  const pre = matched[5] ?? ''
  const wildMinor = minor === undefined || /[xX*]/.test(minor)
  const wildPatch = patch === undefined || /[xX*]/.test(patch)
  const exact = {
    major: Number(major),
    minor: wildMinor ? 0 : Number(minor),
    patch: wildPatch ? 0 : Number(patch),
    pre: wildMinor || wildPatch ? '' : pre,
  }
  const partsSpecified = 1 + (wildMinor ? 0 : 1) + (wildPatch ? 0 : 1)
  if (operator === '^') return { op: 'range', lower: exact, upper: upperForCaret(exact), lowerInclusive: true, upperInclusive: false }
  if (operator === '~') return { op: 'range', lower: exact, upper: upperForTilde(exact, partsSpecified), lowerInclusive: true, upperInclusive: false }
  if (operator === '>' || operator === '>=' || operator === '<' || operator === '<=') {
    return { op: 'cmp', operator, version: exact }
  }
  if (wildMinor) {
    return { op: 'range', lower: exact, upper: { major: exact.major + 1, minor: 0, patch: 0, pre: '' }, lowerInclusive: true, upperInclusive: false }
  }
  if (wildPatch) {
    return { op: 'range', lower: exact, upper: { major: exact.major, minor: exact.minor + 1, patch: 0, pre: '' }, lowerInclusive: true, upperInclusive: false }
  }
  return { op: 'cmp', operator: '=', version: exact }
}

function testComparator(comparator, version) {
  if (comparator === null) return true
  if (comparator.unsupported) return { unsupported: true }
  if (comparator.op === 'range') {
    if (compareVersions(version, comparator.lower) < 0) return false
    if (compareVersions(version, comparator.lower) === 0 && !comparator.lowerInclusive) return false
    const upper = compareVersions(version, comparator.upper)
    if (upper > 0) return false
    if (upper === 0 && !comparator.upperInclusive) return false
    return true
  }
  const order = compareVersions(version, comparator.version)
  switch (comparator.operator) {
    case '>': return order > 0
    case '>=': return order >= 0
    case '<': return order < 0
    case '<=': return order <= 0
    default: return order === 0
  }
}

function expandHyphen(token) {
  const matched = /^\s*(\S+)\s+-\s+(\S+)\s*$/.exec(token)
  if (!matched) return null
  return `>=${matched[1]} <=${matched[2]}`
}

function splitAndTokens(range) {
  return String(range).trim().replace(/,/g, ' ').split(/\s+/).filter(token => token !== '')
}

function hasPrereleaseAnchor(tokens, version) {
  for (const token of tokens) {
    const comparator = parseComparator(token)
    if (comparator === null || comparator.unsupported) continue
    const candidate = comparator.version ?? comparator.lower
    if (candidate && candidate.pre !== '' && candidate.major === version.major && candidate.minor === version.minor && candidate.patch === version.patch) {
      return true
    }
  }
  return false
}

/**
 * @param version 版本字符串
 * @param range 依赖声明（`^1.2.3 || >=2.0.0-rc.1 <3`）
 * @returns {{satisfied:boolean, supported:boolean, reason?:string}}
 */
export function satisfies(version, range) {
  const parsed = typeof version === 'string' ? parseVersion(version) : version
  const declared = String(range ?? '').trim()
  if (parsed === null) return { satisfied: false, supported: false, reason: `版本无法解析：${version}` }
  if (declared === '' || declared === '*' || declared === 'latest') return { satisfied: true, supported: true }
  for (const orPart of declared.split('||')) {
    const tokens = splitAndTokens(orPart)
    let working = tokens
    const hyphen = expandHyphen(orPart)
    if (hyphen !== null) working = splitAndTokens(hyphen)
    let matched = true
    let unsupported = false
    for (const token of working) {
      const result = testComparator(parseComparator(token), parsed)
      if (result === false) {
        matched = false
        break
      }
      if (result && result.unsupported) unsupported = true
    }
    if (matched && !unsupported) {
      if (parsed.pre === '' || hasPrereleaseAnchor(working, parsed)) return { satisfied: true, supported: true }
    }
    if (matched && unsupported) return { satisfied: false, supported: false, reason: `不认识的版本范围：${declared}` }
  }
  return { satisfied: false, supported: true }
}
