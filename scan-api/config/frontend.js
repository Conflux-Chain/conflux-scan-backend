function patchDomain(host, netArr) {
  if (!host) {
    return;
  }
  const lastSeg = host.substr(host.lastIndexOf('.'));
  for(const net of netArr) {
    const {url} = net;
    if (!url || url.endsWith(lastSeg)) {
      continue;
    }
    const headingSeg = url.substring(0, url.lastIndexOf('.'));
    net.url = headingSeg + lastSeg;
  }
}

const scan8888 = {name: 'Conflux Core(Devnet)',   id: 8888, url: 'https://net8888cfx.confluxscan.org'};
const scan8889 = {name: 'Conflux eSpace(Devnet)', id: 8889, url: 'https://net8889eth.confluxscan.org'};
const scan6666 = {name: 'Conflux Core(Devnet)',   id: 6666, url: 'https://net8888cfx.confluxscan.org'};
const scan6667 = {name: 'Conflux eSpace(Devnet)', id: 6667, url: 'https://net8889eth.confluxscan.org'};

module.exports = {
  devScan: {
    8888: [scan8888, scan8889],
    8889: [scan8888, scan8889],
    6666: [scan6666, scan6667],
    6667: [scan6666, scan6667],
  },
  networks: [
    {
      name: 'Conflux Core (Hydra)',
      id: 1029,
    },
    {
      name: 'Conflux eSpace (Hydra)',
      id: 1030,
    },
    {
      name: 'Conflux Core (Testnet)',
      id: 1,
    },
    {
      name: 'Conflux eSpace (Testnet)',
      id: 71,
    },
    {
      name: 'Conflux PoS',
      id: 8888,
    },
  ],
  contracts: [
    {
      key: 'faucet',
      address: {
        1029: 'cfx:acbkxbtruayaf2he1899e1533x4wg2a07eyjjrzu31', // 0x8fc71dbd0e0b3be34fbee62796b65e09c8fd19b8
        1: 'cfxtest:ach6shr7b2fx124t15xctfz0n2e6v9j31ae8gv71pa', // 0x8fc71dbd0e0b3be34fbee62796b65e09c8fd19b8
        8888: 'net8888:ach6shr7b2fx124t15xctfz0n2e6v9j31ayt6833gh', // 0x8fc71dbd0e0b3be34fbee62796b65e09c8fd19b8
      },
    },
    {
      key: 'faucetLast',
      address: {
        1029: 'cfx:acgzz08m8z2ywkeda0jzu52fgaz9u95y1y50rnwmt3', // 0x8097e818c2c2c1524c41f0fcbda143520046d117
        1: 'cfxtest:acakt4a22nbpcywpjh2t3trbjrkaav0vc6enueyd0g', // 0x8097e818c2c2c1524c41f0fcbda143520046d117
        8888: 'net8888:acakt4a22nbpcywpjh2t3trbjrkaav0vc6y4mnur6b', // 0x8097e818c2c2c1524c41f0fcbda143520046d117
      },
    },
    {
      key: 'announcement',
      address: {
        1029: 'cfx:aca514ancmbdu9u349u4m7d0u4jjdv83pyxbdunbz7', // 0x81bbe80b1282387e19d7e1a57476869081c7d965
        1030: '0xdf07c798e70138ca6963ea0db3226e124db59ddd', // 0xdf07c798e70138ca6963ea0db3226e124db59ddd
        1: 'cfxtest:aca514ancmbdu9u349u4m7d0u4jjdv83py3muarnv1', // 0x81bbe80b1282387e19d7e1a57476869081c7d965
        71: '0x623a0340bd4b0817379c8482c92dd26fb8c5316d', // 0x623a0340bd4b0817379c8482c92dd26fb8c5316d
        8888: 'net8888:aca514ancmbdu9u349u4m7d0u4jjdv83pyk5mtkf5u', // 0x81bbe80b1282387e19d7e1a57476869081c7d965
        8889: '0xb5a10342a1594b11bfe305c45ce5b136a51789ff', // 0xb5a10342a1594b11bfe305c45ce5b136a51789ff
      },
    },
    {
      key: 'wcfx',
      address: {
        1029: 'cfx:acg158kvr8zanb1bs048ryb6rtrhr283ma70vz70tx', // 0x8eecac87012c8e25d1a5c27694ae3ddaf2b6572f, note: not same as mainnet WCFX ?
        1: 'cfxtest:achs3nehae0j6ksvy1bhrffsh1rtfrw1f6w1kzv46t', // 0x8eecac87012c8e25d1a5c27694ae3ddaf2b6572f, note: not same as mainnet WCFX ?
        8888: 'net8888:achs3nehae0j6ksvy1bhrffsh1rtfrw1f6cgx4zy0j', // 0x8eecac87012c8e25d1a5c27694ae3ddaf2b6572f, note: not same as mainnet WCFX ?
      },
    },
    {
      key: 'governance',
      address: {
        1029: 'cfx:achvp1x7t17uf2wdad3pdvd0ujz4vfndv2k5x6cpyn', // 0x8f3f525d17159351e4b34fe766ef139470da0b02
        1: 'cfxtest:accm1wxg86xz0wzpjkf4wby40skrcj1psy1j0su169', // 0x8f3f525d17159351e4b34fe766ef139470da0b02
        8888: 'net8888:achx8yw7c6m3gyte0rh8s31tcsmhb0unajzt74tk4s', // 0x8f3f525d17159351e4b34fe766ef139470da0b02
      },
    },
    {
      // inner address
      key: 'adminControl',
      address: {
        1029: 'cfx:aaejuaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2mhjju8k', // 0x0888000000000000000000000000000000000000
        1: 'cfxtest:aaejuaaaaaaaaaaaaaaaaaaaaaaaaaaaaawby2s44d', // 0x0888000000000000000000000000000000000000
        8888: 'net8888:aaejuaaaaaaaaaaaaaaaaaaaaaaaaaaaaacus1myue', // 0x0888000000000000000000000000000000000000
      },
    },
    {
      key: 'sponsorWhitelistControl',
      address: {
        1029: 'cfx:aaejuaaaaaaaaaaaaaaaaaaaaaaaaaaaaegg2r16ar', // 0x0888000000000000000000000000000000000001
        1: 'cfxtest:aaejuaaaaaaaaaaaaaaaaaaaaaaaaaaaaeprn7v0eh', // 0x0888000000000000000000000000000000000001
        8888: 'net8888:aaejuaaaaaaaaaaaaaaaaaaaaaaaaaaaae66vwz2sa', // 0x0888000000000000000000000000000000000001
      },
    },
    {
      key: 'staking',
      address: {
        1029: 'cfx:aaejuaaaaaaaaaaaaaaaaaaaaaaaaaaaajrwuc9jnb', // 0x0888000000000000000000000000000000000002
        1: 'cfxtest:aaejuaaaaaaaaaaaaaaaaaaaaaaaaaaaajh3dw3ctn', // 0x0888000000000000000000000000000000000002
        8888: 'net8888:aaejuaaaaaaaaaaaaaaaaaaaaaaaaaaaaj1j377pfp', // 0x0888000000000000000000000000000000000002
      },
    },
    // {
    //   key: 'context',
    //   address: {
    //     1029: 'cfx:aaejuaaaaaaaaaaaaaaaaaaaaaaaaaaaapx8thaezf', // 0x0888000000000000000000000000000000000003
    //     1: 'cfxtest:aaejuaaaaaaaaaaaaaaaaaaaaaaaaaaaap3z61gsvt', // 0x0888000000000000000000000000000000000003
    //     8888: 'net8888:aaejuaaaaaaaaaaaaaaaaaaaaaaaaaaaapkeg2ca5j', // 0x0888000000000000000000000000000000000003
    //   },
    // },
    {
      key: 'context',
      address: {
        1029: 'cfx:aaejuaaaaaaaaaaaaaaaaaaaaaaaaaaaau5xa6tk73', // 0x0888000000000000000000000000000000000004
        1: 'cfxtest:aaejuaaaaaaaaaaaaaaaaaaaaaaaaaaaauv2xpkd3x', // 0x0888000000000000000000000000000000000004
        8888: 'net8888:aaejuaaaaaaaaaaaaaaaaaaaaaaaaaaaaubkkdrrxy', // 0x0888000000000000000000000000000000000004
      },
    },
    {
      key: 'posRegister',
      address: {
        1029: 'cfx:aaejuaaaaaaaaaaaaaaaaaaaaaaaaaaaayf993ufd7', // 0x0888000000000000000000000000000000000005
        1: 'cfxtest:aaejuaaaaaaaaaaaaaaaaaaaaaaaaaaaaytypk0th1', // 0x0888000000000000000000000000000000000005
        8888: 'net8888:aaejuaaaaaaaaaaaaaaaaaaaaaaaaaaaay9f0gwbru', // 0x0888000000000000000000000000000000000005
      },
    },
    {
      key: 'crossSpaceCall',
      address: {
        1029: 'cfx:aaejuaaaaaaaaaaaaaaaaaaaaaaaaaaaa2sn102vjv', // 0x0888000000000000000000000000000000000006
        1: 'cfxtest:aaejuaaaaaaaaaaaaaaaaaaaaaaaaaaaa2eaeg85p5', // 0x0888000000000000000000000000000000000006
        8888: 'net8888:aaejuaaaaaaaaaaaaaaaaaaaaaaaaaaaa2yv8k4zg6', // 0x0888000000000000000000000000000000000006
      },
    },
    {
      // zero address
      key: 'zero',
      address: {
        1029: 'cfx:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0sfbnjm2', // 0x0000000000000000000000000000000000000000
        1: 'cfxtest:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa6f0vrcsw', // 0x0000000000000000000000000000000000000000
        8888: 'net8888:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaapyp8kpez', // 0x0000000000000000000000000000000000000000
      },
    },
  ],
};
