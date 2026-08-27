# Resources

Additional resources for VinuSwap developers and integrators.

## Documentation Sections

### [Security](security.md)

Security best practices and considerations:

- Smart contract security features
- Integration security patterns
- Common vulnerabilities and mitigations
- Callback security
- Deployment verification procedures

### [FAQ](faq.md)

Frequently asked questions covering:

- General VinuSwap questions
- Swapping mechanics
- Liquidity provision
- Fee management
- Position locking
- Oracle usage
- Development and troubleshooting

## External Resources

### VinuSwap Security

A [Security Companion Document](https://github.com/VinuChain/VinuSwap-Backend/blob/main/Security%20Companion%20Document.pdf) covering VinuSwap's extensions (Controller, TieredDiscount, fee manager system, position locking) is included in the repository root. It is dated 2023-09-04 and predates `OverridableFeeManager`, `createStandardPool`, the unified `createPool`, and `quoteTokensOwed`.

### Uniswap V3 Documentation

VinuSwap is based on Uniswap V3. These resources provide additional context:

- [Uniswap V3 Whitepaper](https://uniswap.org/whitepaper-v3.pdf)
- [Uniswap V3 Development Book](https://uniswapv3book.com/)
- [Uniswap V3 Docs](https://docs.uniswap.org/contracts/v3/overview)

### Mathematical Background

- [Concentrated Liquidity Math](https://atiselsts.github.io/pdfs/uniswap-v3-liquidity-math.pdf)
- [Tick Math Deep Dive](https://blog.uniswap.org/uniswap-v3-math-primer)

### Development Tools

| Tool | Purpose |
|------|---------|
| [Hardhat](https://hardhat.org/) | Development framework |
| [Ethers.js](https://docs.ethers.org/) | Ethereum library |
| [OpenZeppelin](https://openzeppelin.com/) | Security standards |
| [Foundry](https://book.getfoundry.sh/) | Testing toolkit |

## Contract Addresses

### VinuChain Mainnet

| Contract | Address |
|----------|---------|
| VinuSwapFactory | `0xd74dEe1C78D5C58FbdDe619b707fcFbAE50c3EEe` |
| SwapRouter | `0x48f450475a8b501A7480C1Fd02935a7327F713Ad` |
| NonfungiblePositionManager | `0xF699ec0764741f66F81068665eFFAeefA3c6037a` |
| VinuSwapQuoter | `0xEed635Fa2343355d9bA726C379F2B5dEa70fE65C` |
| NonfungibleTokenPositionDescriptor | `0xCA04dFDEE5778f6c23a7BdBa46A8D95F5094e4B5` |
| Controller | `0x47fF80713b1d66DdA47237AB374F3080E2075528` |
| OverridableFeeManager | `0xA15770c5692646667c195446996e1fE9D210374c` |
| NoDiscount (live default policy) | `0xb96178F0517A4E2268B85a76ccFeA7E8382Ca1be` |
| TieredDiscount (deployed, not routed) | `0x58818859dD0179498c530f549270F40fEB48579E` |

Deploy blocks, transaction hashes and legacy deployments:
[`docs/deployments/vinuchain-207.json`](../deployments/vinuchain-207.json).
Explorer: `https://vinuexplorer.org/address/<address>`.

### VinuChain Testnet

| Contract | Address |
|----------|---------|
| Factory | *Not yet deployed* |
| SwapRouter | *Not yet deployed* |
| NonfungiblePositionManager | *Not yet deployed* |
| VinuSwapQuoter | *Not yet deployed* |

## Common Token Addresses

### VinuChain

| Token | Symbol | Decimals | Address |
|-------|--------|----------|---------|
| Wrapped VC | WVC | 18 | `0xEd8c5530a0A086a12f57275728128a60DFf04230` |
| USDT@VinuChain | USDT | 6 | `0xC0264277fcCa5FCfabd41a8bC01c1FcAF8383E41` |
| ETH@VinuChain | ETH | 18 | `0xDd4b9b3Ce03faAbA4a3839c8B5023b7792be6e2C` |
| BTC@VinuChain | BTC | 8 | `0x69120197b77b51d32fFA5eAfe16b3D78115640c6` |
| Vita Inu | VINU | 18 | `0x00c1E515EA9579856304198EFb15f525A0bb50f6` |

## Support Channels

- **GitHub Issues** - Bug reports and feature requests
- **Discord** - Community discussions
- **Twitter** - Announcements

## Contributing

Contributions to VinuSwap are welcome:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

### Development Guidelines

- Follow existing code style
- Write comprehensive tests
- Document new features
- Update relevant documentation

## License

VinuSwap contracts are licensed under:
- Core contracts: BUSL-1.1
- Periphery contracts: GPL-2.0-or-later
- Custom extensions: MIT

See individual contract files for specific licenses.
