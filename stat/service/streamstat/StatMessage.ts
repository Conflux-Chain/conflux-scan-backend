// Notice: The statInfo format is different according to concrete business in different scenarios.
// Format: stat message
// {
//      epochNumber: 29859685,
//      epochTimestamp: '2021-12-09 01:02:03',
//      action: 'push/pop',
//      statInfo:{
//          [addressId1]: 37,
//          [addressId2]: 22,
//          [addressId3]: 106,
//      },
// }
export class StatMessage {
    epochNumber: number;
    epochTimestamp: Date;
    action: string;
    statInfo: object;
}