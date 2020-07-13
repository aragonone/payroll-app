import app from './app'
import tokenDecimalsAbi from '../abi/token-decimals'
import tokenSymbolAbi from '../abi/token-symbol'

const tokenCache = new Map()

export async function getTokenDetails(address) {
  if (!tokenCache.has(address)) {
    const tokenContract = app.external(
      address,
      [].concat(tokenDecimalsAbi, tokenSymbolAbi)
    )
    const [decimals, name, symbol] = await Promise.all([
      loadTokenDecimals(tokenContract),
      loadTokenName(tokenContract),
      loadTokenSymbol(tokenContract),
    ])

    tokenCache.set(address, { address, decimals, name, symbol })
  }

  return tokenCache.get(address)
}

// TODO: add fallback for DAI and fiat curriences
async function loadTokenDecimals(tokenContract) {
  const decimals = tokenContract.decimals().toPromise()
  return parseInt(decimals, 10)
}

function loadTokenName(tokenContract) {
  return tokenContract.name().toPromise()
}

function loadTokenSymbol(tokenContract) {
  return tokenContract.symbol().toPromise()
}
