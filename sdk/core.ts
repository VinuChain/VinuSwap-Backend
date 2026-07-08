import { ethers, BigNumberish } from "ethers";

import { VinuSwapPool } from "../typechain-types/contracts/core/VinuSwapPool";
import { SwapRouter } from "../typechain-types/contracts/periphery/SwapRouter";
import { NonfungiblePositionManager } from "../typechain-types/contracts/periphery/NonfungiblePositionManager";
import { VinuSwapQuoter } from "../typechain-types/contracts/periphery/VinuSwapQuoter";

import { VinuSwapPool__factory } from "../typechain-types/factories/contracts/core/VinuSwapPool__factory";
import { SwapRouter__factory } from "../typechain-types/factories/contracts/periphery/SwapRouter__factory";
import { NonfungiblePositionManager__factory } from "../typechain-types/factories/contracts/periphery/NonfungiblePositionManager__factory";
import { VinuSwapQuoter__factory } from "../typechain-types/factories/contracts/periphery/VinuSwapQuoter__factory";

import ERC20Abi from "./abi/ERC20.json";

import { encodePrice, decodePrice, withCustomTickSpacing } from "./utils";
import { BigNumber } from "@ethersproject/bignumber";

// @ts-ignore
import { Percent, Token } from "@uniswap/sdk-core";
// @ts-ignore
import { TickMath, nearestUsableTick, Position, Pool } from "@uniswap/v3-sdk";
import JSBI from "jsbi";

function normalizeAddress(address: string): string {
  return ethers.utils.getAddress(address);
}

function addressMatches(address: string, candidates: string[]): boolean {
  const normalized = normalizeAddress(address);
  return candidates.some((candidate) => normalized === normalizeAddress(candidate));
}

function validateSlippageRatio(slippageRatio: number): void {
  if (!Number.isFinite(slippageRatio) || slippageRatio < 0 || slippageRatio > 1) {
    throw new Error("slippageRatio must be a finite number between 0 and 1");
  }
}

class VinuSwap {
  public pool: VinuSwapPool;
  public quoter: VinuSwapQuoter;
  public router: SwapRouter;
  public positionManager: NonfungiblePositionManager;
  public token0Contract: ethers.Contract;
  public token1Contract: ethers.Contract;
  public signerOrProvider: ethers.Signer | ethers.providers.Provider;
  public _significantDigits: number = 18;

  // Immutable pool/token data — fetched once in create().
  public readonly fee: number;
  public readonly tickSpacing: number;
  public readonly token0Decimals: number;
  public readonly token1Decimals: number;

  private constructor(
    pool: VinuSwapPool,
    token0Contract: ethers.Contract,
    token1Contract: ethers.Contract,
    quoter: VinuSwapQuoter,
    router: SwapRouter,
    positionManager: NonfungiblePositionManager,
    signerOrProvider: ethers.Signer | ethers.providers.Provider,
    fee: number,
    tickSpacing: number,
    token0Decimals: number,
    token1Decimals: number
  ) {
    this.pool = pool;
    this.quoter = quoter;
    this.router = router;
    this.positionManager = positionManager;
    this.token0Contract = token0Contract;
    this.token1Contract = token1Contract;
    this.signerOrProvider = signerOrProvider;
    this.fee = fee;
    this.tickSpacing = tickSpacing;
    this.token0Decimals = token0Decimals;
    this.token1Decimals = token1Decimals;
  }

  /**
   * Connects the signer to the VinuSwap instance
   * @param signer Signer to connect
   * @returns The same VinuSwap instance with the signer connected
   */
  public connect(signer: ethers.Signer): VinuSwap {
    return new VinuSwap(
      this.pool.connect(signer),
      this.token0Contract.connect(signer),
      this.token1Contract.connect(signer),
      this.quoter.connect(signer),
      this.router.connect(signer),
      this.positionManager.connect(signer),
      signer,
      this.fee,
      this.tickSpacing,
      this.token0Decimals,
      this.token1Decimals
    );
  }

  /**
   * Creates a new VinuSwap instance.
   * Important: tokenA and tokenB are not necessarily the same as token0 and token1
   * @param tokenA Address of one token
   * @param tokenB Address of the other token
   * @param poolAddress Address of the VinuSwap pool
   * @param quoterAddress Address of the VinuSwap quoter
   * @param routerAddress Address of the VinuSwap router
   * @param positionManagerAddress Address of the VinuSwap position manager
   * @param signerOrProvider Signer or provider to use
   * @returns A new VinuSwap instance
   */
  public static async create(
    tokenA: string,
    tokenB: string,
    poolAddress: string,
    quoterAddress: string,
    routerAddress: string,
    positionManagerAddress: string,
    signerOrProvider: ethers.providers.Provider | ethers.Signer
  ): Promise<VinuSwap> {
    const router = new ethers.Contract(
      routerAddress,
      SwapRouter__factory.abi,
      signerOrProvider
    ) as SwapRouter;

    const pool = new ethers.Contract(
      poolAddress,
      VinuSwapPool__factory.abi,
      signerOrProvider
    ) as VinuSwapPool;

    const quoter = new ethers.Contract(
      quoterAddress,
      VinuSwapQuoter__factory.abi,
      signerOrProvider
    ) as VinuSwapQuoter;

    const [token0Address, token1Address, fee, tickSpacing] = await Promise.all([
      pool.token0(),
      pool.token1(),
      pool.fee(),
      pool.tickSpacing(),
    ]);

    const poolTokenAddresses = [token0Address, token1Address];

    if (!addressMatches(tokenA, poolTokenAddresses)) {
      throw new Error("TokenA address does not match");
    }
    if (!addressMatches(tokenB, poolTokenAddresses)) {
      throw new Error("TokenB address does not match");
    }
    if (normalizeAddress(tokenA) === normalizeAddress(tokenB)) {
      throw new Error("TokenA and TokenB addresses are the same");
    }

    const positionManager = new ethers.Contract(
      positionManagerAddress,
      NonfungiblePositionManager__factory.abi,
      signerOrProvider
    ) as NonfungiblePositionManager;

    const token0Contract = new ethers.Contract(
      token0Address,
      ERC20Abi,
      signerOrProvider
    );
    const token1Contract = new ethers.Contract(
      token1Address,
      ERC20Abi,
      signerOrProvider
    );

    const [token0Decimals, token1Decimals] = await Promise.all([
      token0Contract.decimals(),
      token1Contract.decimals(),
    ]);

    return new VinuSwap(
      pool,
      token0Contract,
      token1Contract,
      quoter,
      router,
      positionManager,
      signerOrProvider,
      fee,
      tickSpacing,
      token0Decimals,
      token1Decimals
    );
  }

  get token0Address(): string {
    return this.token0Contract.address;
  }

  get token1Address(): string {
    return this.token1Contract.address;
  }

  /**
   * Whether the pool is locked.
   */
  public async locked(): Promise<boolean> {
    return !(await this.pool.slot0()).unlocked;
  }

  /**
   * The address of the factory that created the pool.
   */
  public async factory(): Promise<string> {
    return this.pool.factory();
  }

  /**
   * A floating point number representing the share of the token0 protocol fees that go to the protocol.
   */
  public async protocolShare0(): Promise<number> {
    const feeProtocol0 = (await this.pool.slot0()).feeProtocol % 16;
    return feeProtocol0 === 0 ? 0 : 1 / feeProtocol0;
  }

  /**
   * A floating point number representing the share of the token1 protocol fees that go to the protocol.
   */
  public async protocolShare1(): Promise<number> {
    const feeProtocol1 = (await this.pool.slot0()).feeProtocol >> 4;
    return feeProtocol1 === 0 ? 0 : 1 / feeProtocol1;
  }

  /**
   * The token0 balance of the pool.
   */
  public async balance0(): Promise<BigNumber> {
    return await this.token0Contract.balanceOf(this.pool.address);
  }

  /**
   * The token1 balance of the pool.
   */
  public async balance1(): Promise<BigNumber> {
    return await this.token1Contract.balanceOf(this.pool.address);
  }

  /**
   * The fee of the pool, expressed in bips (0.01%).
   */
  public async poolFee(): Promise<number> {
    return this.fee;
  }

  /**
   * The ratio between token1 and token0 price.
   */
  public async price(): Promise<string> {
    return decodePrice((await this.pool.slot0()).sqrtPriceX96);
  }

  /**
   * How much fee the protocol has collected.
   */
  public async availableProtocolFees(): Promise<[BigNumber, BigNumber]> {
    const protocolFees = await this.pool.protocolFees();
    return [protocolFees.token0, protocolFees.token1];
  }

  private async fetchPoolState(): Promise<{
    sqrtPriceX96: string;
    tick: number;
    liquidity: string;
  }> {
    const [slot0, liquidity] = await Promise.all([
      this.pool.slot0(),
      this.pool.liquidity(),
    ]);
    return {
      sqrtPriceX96: slot0.sqrtPriceX96.toString(),
      tick: slot0.tick,
      liquidity: liquidity.toString(),
    };
  }

  // Synchronous Pool construction. Must run inside withCustomTickSpacing
  // because @uniswap/v3-sdk's Pool constructor reads TICK_SPACINGS[fee]; once
  // built, the resulting Pool stores tickSpacing as a field so subsequent
  // Position math is safe outside the lock.
  private buildUniswapPool(state: {
    sqrtPriceX96: string;
    tick: number;
    liquidity: string;
  }): Pool {
    const chainId = 0; // We don't care about chainId for math
    return new Pool(
      new Token(chainId, this.token0Contract.address, this.token0Decimals, "Token0"),
      new Token(chainId, this.token1Contract.address, this.token1Decimals, "Token1"),
      this.fee,
      state.sqrtPriceX96,
      state.liquidity,
      state.tick
    );
  }

  protected async asUniswapPool(): Promise<Pool> {
    const state = await this.fetchPoolState();
    return await withCustomTickSpacing(this.fee, this.tickSpacing, () =>
      this.buildUniswapPool(state)
    );
  }

  private validateSwapTokens(tokenIn: string, tokenOut: string): [string, string] {
    const normalizedTokenIn = normalizeAddress(tokenIn);
    const normalizedTokenOut = normalizeAddress(tokenOut);
    const poolTokenAddresses = [
      normalizeAddress(this.token0Contract.address),
      normalizeAddress(this.token1Contract.address),
    ];

    if (!poolTokenAddresses.includes(normalizedTokenIn)) {
      throw new Error("TokenIn address does not match");
    }
    if (!poolTokenAddresses.includes(normalizedTokenOut)) {
      throw new Error("TokenOut address does not match");
    }
    if (normalizedTokenIn === normalizedTokenOut) {
      throw new Error("TokenIn and TokenOut addresses are the same");
    }

    return [normalizedTokenIn, normalizedTokenOut];
  }

  // Fetches everything needed to build a Position for `nftId` in parallel,
  // then constructs Pool + Position inside the tick-spacing lock. liquidity
  // override is supported for "what-if" quotes (decreaseLiquidity).
  private async loadPosition(
    nftId: BigNumberish,
    liquidityOverride?: BigNumberish
  ): Promise<{
    pool: Pool;
    position: Position;
    raw: Awaited<ReturnType<NonfungiblePositionManager["positions"]>>;
  }> {
    const [poolState, raw] = await Promise.all([
      this.fetchPoolState(),
      this.positionManager.positions(nftId),
    ]);
    return await withCustomTickSpacing(this.fee, this.tickSpacing, () => {
      const pool = this.buildUniswapPool(poolState);
      const position = new Position({
        pool,
        liquidity: (liquidityOverride ?? raw.liquidity).toString(),
        tickLower: raw.tickLower,
        tickUpper: raw.tickUpper,
      });
      return { pool, position, raw };
    });
  }

  /**
   * Retrieves the NFT IDs of all positions owned by a given address.
   * @param owner The address of the owner
   * @returns An array containing the NFT IDs of the positions
   */
  public async positionIdsByOwner(owner: string): Promise<BigNumber[]> {
    const numPositions = await this.positionManager.balanceOf(owner);

    const promises = [];

    for (let i = BigNumber.from(0); i.lt(numPositions); i = i.add(1)) {
      promises.push(this.positionManager.tokenOfOwnerByIndex(owner, i));
    }

    return await Promise.all(promises);
  }

  /**
   * The operator, if any, of a given position.
   * @param nftId The NFT ID of the position
   * @returns The operator address. If no operator is set, returns the zero address
   */
  public async positionOperator(nftId: BigNumberish): Promise<string> {
    return (await this.positionManager.positions(nftId)).operator;
  }

  public async positionPriceBounds(
    nftId: BigNumberish
  ): Promise<[string, string]> {
    const { position } = await this.loadPosition(nftId);
    return [
      position.token0PriceLower.toSignificant(this._significantDigits),
      position.token0PriceUpper.toSignificant(this._significantDigits),
    ];
  }

  /**
   * The amount of token0 in a given position.
   * @param nftId The NFT ID of the position
   * @returns The amount of token0
   */
  public async positionAmount0(nftId: BigNumberish): Promise<BigNumber> {
    const { position } = await this.loadPosition(nftId);
    return BigNumber.from(position.amount0.numerator.toString());
  }

  /**
   * The amount of token1 in a given position.
   * @param nftId The NFT ID of the position
   * @returns The amount of token1
   */
  public async positionAmount1(nftId: BigNumberish): Promise<BigNumber> {
    const { position } = await this.loadPosition(nftId);
    return BigNumber.from(position.amount1.numerator.toString());
  }

  /**
   * The liquidity of a given position. Note: this is an internal number used by VinuSwap,
   * and is not the same as the amount of token0 or token1 in the position.
   * @param nftId The NFT ID of the position
   * @returns The liquidity
   */
  public async positionLiquidity(nftId: BigNumberish): Promise<BigNumber> {
    return (await this.positionManager.positions(nftId)).liquidity;
  }

  /**
   * The date until a given position is locked. If the position is not locked, returns a date in the past.
   * @param nftId The NFT ID of the position
   * @returns The date until the position is locked. If the position has never been locked, returns null.
   */
  public async positionLockedUntil(nftId: BigNumberish): Promise<Date | null> {
    const lockedUntil = (
      await this.positionManager.positions(nftId)
    ).lockedUntil.toString();

    if (lockedUntil == "0") {
      return null;
    }

    return new Date(parseInt(lockedUntil) * 1000);
  }

  /**
   * Whether a given position is locked.
   * @param nftId The NFT ID of the position
   * @returns True if the position is locked, false otherwise
   */
  public async positionIsLocked(nftId: BigNumberish): Promise<boolean> {
    const lockedUntil = await this.positionLockedUntil(nftId);
    return lockedUntil !== null && lockedUntil.getTime() > Date.now();
  }

  /**
   * The tokenURI of a given position.
   * @param nftId The NFT ID of the position
   * @returns The tokenURI
   */
  public async positionTokenURI(nftId: BigNumberish): Promise<string> {
    return this.positionManager.tokenURI(nftId);
  }

  /**
   * The tokens owed to the position owner.
   * @param nftId The NFT ID of the position
   * @returns A tuple containing the amount of token0 and token1 owed to the position owner
   */
  public async positionTokensOwed(
    nftId: BigNumberish
  ): Promise<[BigNumber, BigNumber]> {
    return await this.positionManager.callStatic.quoteTokensOwed(nftId);
  }

  /**
   * The owner of a given position.
   * @param nftId The NFT ID of the position
   * @returns The owner address
   */
  public async positionOwner(nftId: BigNumberish): Promise<string> {
    return await this.positionManager.ownerOf(nftId);
  }

  /**
   * Mint a new position in the pool.
   * @param ratioLower The lowest price ratio at which the position will provide liquidity
   * @param ratioUpper The highest price ratio at which the position will provide liquidity
   * @param amount0Desired How much token0 to provide. Note: this is not the final amount of token0 in the position
   * @param amount1Desired How much token1 to provide. Note: this is not the final amount of token1 in the position
   * @param slippageRatio A number between 0 and 1 representing the maximum slippage ratio
   * @param recipient Who will receive the NFT
   * @param deadline Deadline for the transaction
   * @returns The mint transaction
   */
  public async mint(
    ratioLower: number,
    ratioUpper: number,
    amount0Desired: BigNumberish,
    amount1Desired: BigNumberish,
    slippageRatio: number,
    recipient: string,
    deadline: Date
  ): Promise<ethers.ContractTransaction> {
    validateSlippageRatio(slippageRatio);

    const sqrtRatioX96Lower = encodePrice(ratioLower.toString());
    const sqrtRatioX96Upper = encodePrice(ratioUpper.toString());

    let tickLower = TickMath.getTickAtSqrtRatio(
      JSBI.BigInt(sqrtRatioX96Lower.toString())
    );
    let tickUpper = TickMath.getTickAtSqrtRatio(
      JSBI.BigInt(sqrtRatioX96Upper.toString())
    );

    tickLower = nearestUsableTick(tickLower, this.tickSpacing);
    tickUpper = nearestUsableTick(tickUpper, this.tickSpacing);

    if (tickLower < TickMath.MIN_TICK || tickUpper > TickMath.MAX_TICK) {
      throw new Error("Invalid tick range");
    }

    const poolState = await this.fetchPoolState();
    const slippageBounds = await withCustomTickSpacing(this.fee, this.tickSpacing, () => {
      const pool = this.buildUniswapPool(poolState);
      const position = Position.fromAmounts({
        pool,
        tickLower,
        tickUpper,
        amount0: amount0Desired.toString(),
        amount1: amount1Desired.toString(),
        useFullPrecision: true,
      });
      return position.mintAmountsWithSlippage(
        new Percent(Math.floor(slippageRatio * 10_000), 10_000)
      );
    });

    const tx = await this.positionManager.mint(
      {
        token0: this.token0Contract.address,
        token1: this.token1Contract.address,
        fee: this.fee,
        tickLower,
        tickUpper,
        amount0Desired,
        amount1Desired,
        amount0Min: slippageBounds.amount0.toString(),
        amount1Min: slippageBounds.amount1.toString(),
        recipient,
        deadline: Math.ceil(deadline.getTime() / 1000),
      }
      //{ gasLimit: 1000000 }
    );
    return tx;
  }

  /**
   * Quote the amount of token0 and token1 that will be minted in a new position.
   * @param ratioLower The lowest price ratio at which the position will provide liquidity
   * @param ratioUpper The highest price ratio at which the position will provide liquidity
   * @param amount0Desired How much token0 to provide. Note: this is not the final amount of token0 in the position
   * @param amount1Desired How much token1 to provide. Note: this is not the final amount of token1 in the position
   * @returns A tuple containing the amount of token0 and token1 that will be minted
   */
  public async quoteMint(
    ratioLower: number,
    ratioUpper: number,
    amount0Desired: BigNumberish,
    amount1Desired: BigNumberish
  ): Promise<[BigNumber, BigNumber]> {
    const sqrtRatioX96Lower = encodePrice(ratioLower.toString());
    const sqrtRatioX96Upper = encodePrice(ratioUpper.toString());

    let tickLower = TickMath.getTickAtSqrtRatio(
      JSBI.BigInt(sqrtRatioX96Lower.toString())
    );
    let tickUpper = TickMath.getTickAtSqrtRatio(
      JSBI.BigInt(sqrtRatioX96Upper.toString())
    );

    tickLower = nearestUsableTick(tickLower, this.tickSpacing);
    tickUpper = nearestUsableTick(tickUpper, this.tickSpacing);

    if (tickLower < TickMath.MIN_TICK || tickUpper > TickMath.MAX_TICK) {
      throw new Error("Invalid tick range");
    }

    const poolState = await this.fetchPoolState();
    const position = await withCustomTickSpacing(this.fee, this.tickSpacing, () => {
      const pool = this.buildUniswapPool(poolState);
      return Position.fromAmounts({
        pool,
        tickLower,
        tickUpper,
        amount0: amount0Desired.toString(),
        amount1: amount1Desired.toString(),
        useFullPrecision: true,
      });
    });

    return [
      BigNumber.from(position.amount0.numerator.toString()),
      BigNumber.from(position.amount1.numerator.toString()),
    ];
  }

  /**
   * Quote the amount obtained by swapping with a given amount of tokenIn.
   * @param tokenIn The address of the token to swap
   * @param tokenOut The address of the token to receive
   * @param amountIn The amount of tokenIn to swap
   * @returns The amount of tokenOut that will be received
   */
  public async quoteExactInput(
    tokenIn: string,
    tokenOut: string,
    amountIn: BigNumberish
  ) {
    const [normalizedTokenIn, normalizedTokenOut] = this.validateSwapTokens(tokenIn, tokenOut);

    const quote = await this.quoter.callStatic.quoteExactInputSingle({
      tokenIn: normalizedTokenIn,
      tokenOut: normalizedTokenOut,
      fee: this.fee,
      amountIn,
      sqrtPriceLimitX96: 0,
    });

    return quote.amountOut.toString();
  }

  /**
   * Swap a given amount of tokenIn for tokenOut.
   * @param tokenIn The address of the token to swap
   * @param tokenOut The address of the token to receive
   * @param amountIn The amount of tokenIn to swap
   * @param amountOutMinimum The minimum amount of tokenOut to receive
   * @param recipient The address that will receive the tokenOut
   * @param deadline The deadline for the transaction
   * @returns The swap transaction
   */
  public async swapExactInput(
    tokenIn: string,
    tokenOut: string,
    amountIn: BigNumberish,
    amountOutMinimum: BigNumberish,
    recipient: string,
    deadline: Date
  ): Promise<ethers.ContractTransaction> {
    const [normalizedTokenIn, normalizedTokenOut] = this.validateSwapTokens(tokenIn, tokenOut);

    const tx = await this.router.exactInputSingle({
      tokenIn: normalizedTokenIn,
      tokenOut: normalizedTokenOut,
      fee: this.fee,
      amountIn,
      amountOutMinimum,
      recipient,
      deadline: Math.ceil(deadline.getTime() / 1000),
      sqrtPriceLimitX96: 0, // We don't use this, since amountOutMinimum is enough for slippage management
    });
    return tx;
  }

  /**
   * Quote the amount of tokenIn needed to obtain a given amount of tokenOut.
   * @param tokenIn The address of the token to swap
   * @param tokenOut The address of the token to receive
   * @param amountOut The amount of tokenOut to receive
   * @returns The amount of tokenIn needed
   */
  public async quoteExactOutput(
    tokenIn: string,
    tokenOut: string,
    amountOut: BigNumberish
  ) {
    const [normalizedTokenIn, normalizedTokenOut] = this.validateSwapTokens(tokenIn, tokenOut);

    const quote = await this.quoter.callStatic.quoteExactOutputSingle({
      tokenIn: normalizedTokenIn,
      tokenOut: normalizedTokenOut,
      fee: this.fee,
      amount: amountOut, // Note that the nomenclature is different here compared to quoteExactInput
      sqrtPriceLimitX96: 0,
    });

    return quote.amountIn.toString();
  }

  /**
   * Swap tokenIn for a given amount of tokenOut.
   * @param tokenIn The address of the token to swap
   * @param tokenOut The address of the token to receive
   * @param amountOut The amount of tokenOut to receive
   * @param amountInMaximum The maximum amount of tokenIn to swap
   * @param recipient The address that will receive the tokenOut
   * @param deadline The deadline for the transaction
   * @returns The swap transaction
   */
  public async swapExactOutput(
    tokenIn: string,
    tokenOut: string,
    amountOut: string,
    amountInMaximum: string,
    recipient: string,
    deadline: Date
  ): Promise<ethers.ContractTransaction> {
    const [normalizedTokenIn, normalizedTokenOut] = this.validateSwapTokens(tokenIn, tokenOut);

    const tx = await this.router.exactOutputSingle({
      tokenIn: normalizedTokenIn,
      tokenOut: normalizedTokenOut,
      fee: this.fee,
      amountOut,
      amountInMaximum,
      recipient,
      deadline: Math.ceil(deadline.getTime() / 1000),
      sqrtPriceLimitX96: 0, // We don't use this, since amountInMaximum is enough for slippage management
    });
    return tx;
  }

  /**
   * Burn a given position.
   * Note: this transaction cannot be called if the position has outstanding liquidity
   * or fees to collect.
   * @param nftId The NFT ID of the position
   * @returns The burn transaction
   */
  public async burn(nftId: BigNumberish): Promise<ethers.Transaction> {
    return await this.positionManager.burn(nftId);
  }

  /**
   * Collect the fees owed to the position owner.
   * @param nftId The NFT ID of the position
   * @param recipient The address that will receive the fees
   * @param amount0Max The maximum amount of token0 to collect
   * @param amount1Max The maximum amount of token1 to collect
   * @returns The collect transaction
   */
  public async collect(
    nftId: BigNumberish,
    recipient: string,
    amount0Max: BigNumberish,
    amount1Max: BigNumberish
  ): Promise<ethers.ContractTransaction> {
    const tx = await this.positionManager.collect({
      tokenId: nftId,
      recipient,
      amount0Max,
      amount1Max,
    });

    return tx;
  }

  /**
   * Collect the protocol fees.
   * @param recipient The address that will receive the fees
   * @param amount0Requested The amount of token0 to collect
   * @param amount1Requested The amount of token1 to collect
   * @returns The collect transaction
   */
  public async collectProtocol(
    recipient: string,
    amount0Requested: BigNumberish,
    amount1Requested: BigNumberish
  ): Promise<ethers.ContractTransaction> {
    const tx = await this.pool.collectProtocol(
      recipient,
      amount0Requested,
      amount1Requested
    );

    return tx;
  }

  /**
   * Increase the liquidity of a given position.
   * @param nftId The NFT ID of the position
   * @param amount0Desired The desired amount of token0 to add. Note: this is not the final amount of token0 that will be added
   * @param amount1Desired The desired amount of token1 to add. Note: this is not the final amount of token1 that will be added
   * @param amount0Min The minimum amount of token0 to add
   * @param amount1Min The minimum amount of token1 to add
   * @param deadline The deadline for the transaction
   * @returns The liquidity increase transaction
   */
  public async increaseLiquidity(
    nftId: BigNumberish,
    amount0Desired: BigNumberish,
    amount1Desired: BigNumberish,
    amount0Min: BigNumberish,
    amount1Min: BigNumberish,
    deadline: Date
  ): Promise<ethers.ContractTransaction> {
    const tx = await this.positionManager.increaseLiquidity({
      tokenId: nftId,
      amount0Desired,
      amount1Desired,
      amount0Min,
      amount1Min,
      deadline: Math.ceil(deadline.getTime() / 1000),
    });

    return tx;
  }

  /**
   * Quote the amount of token0 and token1 that will be added to a given position.
   * @param nftId The NFT ID of the position
   * @param amount0Desired The desired amount of token0 to add. Note: this is not the final amount of token0 that will be added
   * @param amount1Desired The desired amount of token1 to add. Note: this is not the final amount of token1 that will be added
   * @returns A tuple containing the amount of token0 and token1 that will be added
   */
  public async quoteIncreaseLiquidity(
    nftId: BigNumberish,
    amount0Desired: BigNumberish,
    amount1Desired: BigNumberish
  ): Promise<[BigNumber, BigNumber]> {
    const { pool, position: oldPosition, raw } = await this.loadPosition(nftId);

    const amount0 = oldPosition.amount0.numerator.toString();
    const amount1 = oldPosition.amount1.numerator.toString();

    const newPosition = await withCustomTickSpacing(this.fee, this.tickSpacing, () =>
      Position.fromAmounts({
        pool,
        tickLower: raw.tickLower,
        tickUpper: raw.tickUpper,
        amount0: BigNumber.from(amount0)
          .add(BigNumber.from(amount0Desired))
          .toString(),
        amount1: BigNumber.from(amount1)
          .add(BigNumber.from(amount1Desired))
          .toString(),
        useFullPrecision: true,
      })
    );

    return [
      BigNumber.from(
        newPosition.amount0.subtract(oldPosition.amount0).numerator.toString()
      ),
      BigNumber.from(
        newPosition.amount1.subtract(oldPosition.amount1).numerator.toString()
      ),
    ];
  }

  /**
   * Decrease the liquidity of a given position.
   * Note: the liquidity isn't transferred directly to the position owner,
   * but is instead added to the fees to be collected by the owner.
   * @param nftId The NFT ID of the position
   * @param liquidity The amount of liquidity to remove
   * @param amount0Min The minimum amount of token0 to remove
   * @param amount1Min The minimum amount of token1 to remove
   * @param deadline The deadline for the transaction
   * @returns The liquidity decrease transaction
   */
  public async decreaseLiquidity(
    nftId: BigNumberish,
    liquidity: BigNumberish,
    amount0Min: BigNumberish,
    amount1Min: BigNumberish,
    deadline: Date
  ): Promise<ethers.ContractTransaction> {
    const tx = await this.positionManager.decreaseLiquidity({
      tokenId: nftId,
      liquidity,
      amount0Min,
      amount1Min,
      deadline: Math.ceil(deadline.getTime() / 1000),
    });

    return tx;
  }

  /**
   * Quote the amount of token0 and token1 that will be removed from a given position.
   * @param nftId The NFT ID of the position
   * @param liquidity The amount of liquidity to remove
   * @returns A tuple containing the amount of token0 and token1 that will be removed
   */
  public async quoteDecreaseLiquidity(
    nftId: BigNumberish,
    liquidity: BigNumberish
  ): Promise<[BigNumber, BigNumber]> {
    const { pool, position: oldPosition, raw } = await this.loadPosition(nftId);
    const newPosition = await withCustomTickSpacing(this.fee, this.tickSpacing, () =>
      new Position({
        pool,
        liquidity: raw.liquidity.sub(liquidity).toString(),
        tickLower: raw.tickLower,
        tickUpper: raw.tickUpper,
      })
    );

    return [
      BigNumber.from(
        oldPosition.amount0.subtract(newPosition.amount0).numerator.toString()
      ),
      BigNumber.from(
        oldPosition.amount1.subtract(newPosition.amount1).numerator.toString()
      ),
    ];
  }

  /**
   * Lock a given position until a certain date.
   * @param nftId The NFT ID of the position
   * @param lockedUntil The date until the position will be locked
   * @param deadline The deadline for the transaction
   * @returns The lock transaction
   */
  public async lock(
    nftId: BigNumberish,
    lockedUntil: Date,
    deadline: Date
  ): Promise<ethers.ContractTransaction> {
    const tx = await this.positionManager.lock(
      nftId,
      Math.floor(lockedUntil.getTime() / 1000),
      Math.ceil(deadline.getTime() / 1000)
    );
    return tx;
  }
}

export default VinuSwap;
