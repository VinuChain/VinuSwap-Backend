# SDK Examples

Complete examples for common VinuSwap operations.

## Basic Setup

```typescript
import { ethers, BigNumber } from 'ethers';
import VinuSwap from './sdk/core';
import { encodePrice, decodePrice } from './sdk/utils';

// Configuration
const config = {
    rpcUrl: 'https://rpc.vinuchain.org',
    factory: '0xd74dEe1C78D5C58FbdDe619b707fcFbAE50c3EEe',
    quoter: '0xEed635Fa2343355d9bA726C379F2B5dEa70fE65C',
    router: '0x48f450475a8b501A7480C1Fd02935a7327F713Ad',
    positionManager: '0xF699ec0764741f66F81068665eFFAeefA3c6037a',
    wvc: '0xEd8c5530a0A086a12f57275728128a60DFf04230',      // Wrapped VC (native token)
    usdt: '0xC0264277fcCa5FCfabd41a8bC01c1FcAF8383E41',     // USDT on VinuChain
    pool: '0x...'       // Pool address (depends on token pair)
};

// Setup
const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

async function getSDK() {
    const sdk = await VinuSwap.create(
        config.wvc,
        config.usdt,
        config.pool,
        config.quoter,
        config.router,
        config.positionManager,
        provider
    );
    return sdk.connect(signer);
}
```

## Swap Examples

### Simple Swap

```typescript
async function simpleSwap() {
    const sdk = await getSDK();

    // Swap 0.1 WVC for USDT
    const amountIn = ethers.utils.parseEther('0.1');

    // Get quote first
    const amountOut = BigNumber.from(
        await sdk.quoteExactInput(config.wvc, config.usdt, amountIn)
    );
    console.log('Expected:', ethers.utils.formatUnits(amountOut, 6), 'USDT');

    // Calculate minimum with 0.5% slippage
    const minOut = amountOut.mul(9950).div(10000);

    // Execute swap
    const tx = await sdk.swapExactInput(
        config.wvc,
        config.usdt,
        amountIn,
        minOut,
        await signer.getAddress(),
        new Date(Date.now() + 1800_000)
    );
    const receipt = await tx.wait();
    console.log('Swap executed:', receipt.transactionHash);
}
```

### Swap with Price Limit

```typescript
async function swapWithPriceLimit() {
    const sdk = await getSDK();

    const amountIn = ethers.utils.parseEther('1');

    // Set price limit (won't swap beyond this price)
    const maxPrice = '0.5'; // Max 0.5 USDT per WVC
    const sqrtPriceLimitX96 = encodePrice(maxPrice);

    const result = await sdk.router.exactInputSingle({
        tokenIn: config.wvc,
        tokenOut: config.usdt,
        fee: 3000,
        recipient: await signer.getAddress(),
        deadline: Math.floor(Date.now() / 1000) + 1800,
        amountIn,
        amountOutMinimum: 0,
        sqrtPriceLimitX96
    });

    console.log('Swap executed with price limit');
}
```

### Multi-Hop Swap

```typescript
async function multiHopSwap() {
    const sdk = await getSDK();
    const TOKEN_C = '0x...';  // Third token in the path

    // Swap WVC → USDT → TOKEN_C
    const path = encodePath(
        [config.wvc, config.usdt, TOKEN_C],
        [3000, 500]
    );

    const amountIn = ethers.utils.parseEther('0.5');

    // Get quote
    const [amountOut] = await sdk.quoter.callStatic.quoteExactInput(
        path,
        amountIn
    );

    // Execute multi-hop swap
    const tx = await sdk.router.exactInput({
        path,
        recipient: await signer.getAddress(),
        deadline: Math.floor(Date.now() / 1000) + 1800,
        amountIn,
        amountOutMinimum: amountOut.mul(99).div(100)
    });

    await tx.wait();
    console.log('Multi-hop swap completed');
}
```

## Liquidity Examples

### Create Position

```typescript
async function createPosition() {
    const sdk = await getSDK();

    // Define price range using price ratios (token1/token0): 1900 to 2100
    // Amounts to add
    const amount0 = ethers.utils.parseUnits('1000', 6);  // 1000 USDT
    const amount1 = ethers.utils.parseEther('0.5');       // 0.5 WVC

    // Approve tokens
    await sdk.token0Contract.approve(config.positionManager, amount0);
    await sdk.token1Contract.approve(config.positionManager, amount1);

    // Mint position (ratioLower, ratioUpper are price ratios, not ticks)
    const tx = await sdk.mint(
        1900,    // lower price ratio (token1/token0)
        2100,    // upper price ratio
        amount0,
        amount1,
        0.005,   // 0.5% slippage — must be a finite number in [0, 1]
        await signer.getAddress(),
        new Date(Date.now() + 1800_000)
    );
    const receipt = await tx.wait();
    console.log('Position created, tx:', receipt.transactionHash);
    // tokenId / liquidity / amounts are emitted in the receipt's events
}
```

### Add to Existing Position

```typescript
async function addLiquidity(tokenId: ethers.BigNumber) {
    const sdk = await getSDK();

    const additionalAmount0 = ethers.utils.parseUnits('500', 6);
    const additionalAmount1 = ethers.utils.parseEther('0.25');

    // Approve
    await sdk.token0Contract.approve(config.positionManager, additionalAmount0);
    await sdk.token1Contract.approve(config.positionManager, additionalAmount1);

    // Increase liquidity
    const result = await sdk.increaseLiquidity(
        tokenId,
        additionalAmount0,
        additionalAmount1,
        0,
        0,
        new Date(Date.now() + 1800_000)
    );

    await result.wait();
    console.log('Liquidity increased, tx:', result.hash);
}
```

### Collect Fees

```typescript
async function collectFees(tokenId: ethers.BigNumber) {
    const sdk = await getSDK();
    const recipient = await signer.getAddress();

    const result = await sdk.collect(
        tokenId,
        recipient,
        ethers.constants.MaxUint128,
        ethers.constants.MaxUint128
    );

    await result.wait();
    console.log('Collected, tx:', result.hash);
}
```

### Close Position

```typescript
async function closePosition(tokenId: ethers.BigNumber) {
    const sdk = await getSDK();

    // Get position info
    const position = await sdk.positionManager.positions(tokenId);

    // 1. Remove all liquidity
    if (position.liquidity.gt(0)) {
        await sdk.decreaseLiquidity(
            tokenId,
            position.liquidity,
            0,
            0,
            new Date(Date.now() + 1800_000)
        );
    }

    // 2. Collect all tokens
    await sdk.collect(
        tokenId,
        await signer.getAddress(),
        ethers.constants.MaxUint128,
        ethers.constants.MaxUint128
    );

    // 3. Burn the NFT
    await sdk.burn(tokenId);

    console.log('Position closed and burned');
}
```

## Pool Monitoring

### Watch Pool State

```typescript
async function monitorPool() {
    const sdk = await getSDK();

    // Get initial state
    const slot0 = await sdk.pool.slot0();
    const liquidity = await sdk.pool.liquidity();
    console.log('Current tick:', slot0.tick);
    console.log('Current liquidity:', liquidity.toString());

    // Subscribe to swap events
    sdk.pool.on('Swap', (sender, recipient, amount0, amount1, sqrtPriceX96, liquidity, tick) => {
        console.log('Swap detected!');
        console.log('  New tick:', tick);
        console.log('  Amount0:', amount0.toString());
        console.log('  Amount1:', amount1.toString());
    });

    console.log('Monitoring swaps...');
}
```

### Get Position Value

```typescript
async function getPositionValue(tokenId: ethers.BigNumber) {
    const sdk = await getSDK();

    const position = await sdk.positionManager.positions(tokenId);
    const slot0 = await sdk.pool.slot0();

    // Calculate token amounts
    const { amount0, amount1 } = getAmountsForLiquidity(
        slot0.sqrtPriceX96,
        getSqrtRatioAtTick(position.tickLower),
        getSqrtRatioAtTick(position.tickUpper),
        position.liquidity
    );

    // Get token prices
    const price = decodePrice(slot0.sqrtPriceX96);

    // Calculate total value in token1
    const value0InToken1 = amount0.mul(Math.floor(price * 1e6)).div(1e6);
    const totalValue = value0InToken1.add(amount1);

    console.log('Position value:');
    console.log('  Token0:', ethers.utils.formatUnits(amount0, 6));
    console.log('  Token1:', ethers.utils.formatEther(amount1));
    console.log('  Total (in token1):', ethers.utils.formatEther(totalValue));
}
```

## Error Handling

```typescript
async function safeOperation() {
    const sdk = await getSDK();

    try {
        await sdk.swapExactInput(...);
    } catch (error: any) {
        // Parse error
        if (error.code === 'INSUFFICIENT_FUNDS') {
            console.error('Not enough VC for gas');
        } else if (error.message.includes('STF')) {
            console.error('Transfer failed - check token balance and allowance');
        } else if (error.message.includes('Too little received')) {
            console.error('Slippage too high - try increasing tolerance');
        } else if (error.message.includes('Transaction too old')) {
            console.error('Transaction expired - try again');
        } else if (error.message.includes('Locked')) {
            console.error('Position is locked');
        } else {
            console.error('Unknown error:', error.message);
        }
    }
}
```

## Full DApp Example

```typescript
class VinuSwapDApp {
    private sdk: VinuSwap | null = null;

    async connect(signer: ethers.Signer) {
        const base = await VinuSwap.create(
            config.wvc,
            config.usdt,
            config.pool,
            config.quoter,
            config.router,
            config.positionManager,
            signer.provider!
        );
        this.sdk = base.connect(signer);
        return this.getAddress();
    }

    async getAddress() {
        return (this.sdk?.signerOrProvider as ethers.Signer | undefined)?.getAddress();
    }

    async getBalances() {
        if (!this.sdk) throw new Error('Not connected');
        const address = await this.getAddress();

        const [bal0, bal1] = await Promise.all([
            this.sdk.token0Contract.balanceOf(address),
            this.sdk.token1Contract.balanceOf(address)
        ]);

        return { token0: bal0, token1: bal1 };
    }

    async getQuote(amountIn: ethers.BigNumber) {
        if (!this.sdk) throw new Error('Not connected');
        return BigNumber.from(await this.sdk.quoteExactInput(config.wvc, config.usdt, amountIn));
    }

    async swap(amountIn: ethers.BigNumber, slippage: number = 0.5) {
        if (!this.sdk) throw new Error('Not connected');

        const quote = await this.getQuote(amountIn);
        const minOut = quote.mul(10000 - slippage * 100).div(10000);

        return this.sdk.swapExactInput(
            config.wvc,
            config.usdt,
            amountIn,
            minOut,
            (await this.getAddress())!,
            new Date(Date.now() + 1800_000)
        );
    }

    async getPositions() {
        if (!this.sdk) throw new Error('Not connected');
        const address = await this.getAddress();

        const balance = await this.sdk.positionManager.balanceOf(address);
        const positions = [];

        for (let i = 0; i < balance.toNumber(); i++) {
            const tokenId = await this.sdk.positionManager.tokenOfOwnerByIndex(address, i);
            const position = await this.sdk.positionManager.positions(tokenId);
            positions.push({ tokenId, ...position });
        }

        return positions;
    }
}

// Usage
const dapp = new VinuSwapDApp();
await dapp.connect(signer);
const quote = await dapp.getQuote(ethers.utils.parseEther('1'));
console.log('Quote:', quote);
```
