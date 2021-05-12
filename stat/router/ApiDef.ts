import {TOP_CFX_HOLD} from "../model/TopRecord";

export default {
    "openapi": "3.0.0",
    "info": {
        "title": "statistics api",
        "description": "statistics api",
        "contact": {},
        "license": {},
        "version": "1.0.0"
    },
    "servers": [
        {
            "url": "",
            "description": "This server."
        }
    ],
    "tags": [
        {
            "name": "Top N",
            "description": "Top N"
        }, {
            name: "developers"
        }
    ],
    "paths": {
        '/stat/contract/all': {
            "get": {
                tags: ['contract'],
                "parameters": [],
                "responses": {
                    "200": {}
                }
            }
        },
        '/stat/tokens/nft-token-id-count': {
            "get": {
                tags: ['tokens'],
                "parameters": [
                    {name:"render", required: true, in: "query", schema:{type:"string"}}
                ],
                "responses": {
                    "200": {}
                }
            }
        },
        '/stat/account-token-balance': {
            "get": {
                tags: ['tokens'],
                "parameters": [
                    {name:"base32", required: true, in: "query", schema:{type:"string", default: ''}},
                    {name:"tokenType", required: true, in: "query", schema:{type:"string", default: 'ERC721'}
                        , description:'only support 721 for now.'}
                ],
                "responses": {
                    "200": {}
                }
            }
        },
        '/stat/tokens/daily-token-txn': {
            "get": {
                tags: ['tokens'],
                "parameters": [
                    {name:"limit", required: true, in: "query", schema:{type:"number", default: 60}}
                ],
                "responses": {
                    "200": {}
                }
            }
        },
        '/stat/daily-cfx-txn': {
            "get": {
                tags: ['tokens'],
                "parameters": [
                    {name:"limit", required: true, in: "query", schema:{type:"number", default: 60}}
                ],
                "responses": {
                    "200": {}
                }
            }
        },
        '/stat/daily-address-creation': {
            "get": {tags: ['daily'],
                "parameters": [
                    {name:"limit", required: true, in: "query", schema:{type:"number", default: 60}}
                ],
                "responses": {"200": {}}
            }
        },
        '/stat/daily-active-address': {
            "get": {tags: ['daily'],
                "parameters": [
                    {name:"limit", required: true, in: "query", schema:{type:"number", default: 60}}
                ],
                "responses": {"200": {}}
            }
        },
        '/stat/daily-token-stat': {
            "get": {tags: ['daily'],
                "parameters": [
                    {name:"limit", required: true, in: "query", schema:{type:"number", default: 60}}
                    ,{name:"base32", required: true, in: "query", schema:{type:"string", default: ''}}
                ],
                "responses": {"200": {}}
            }
        },
        '/stat/tokens/erc1155/balance-of': {
            "get": {
                tags: ['tokens'],
                "parameters": [
                    {name:"address", required: true, in: "query", schema:{type:"string"}}
                ],
                "responses": {
                    "200": {}
                }
            }
        },
        '/stat/tokens/by-address': {
            tags: ['tokens'],
            "get": {
                tags: ['tokens'],
                "parameters": [
                    {name:"address", required: true, in: "query", schema:{type:"string"}}
                ],
                "responses": {
                    "200": {}
                }
            }
        },
        '/stat/tokens/holder-rank': {
            description: 'rank holder by balance',
            "get": {
                "parameters": [
                    {
                        "name": "address",
                        "in": "query",
                        "required": true,
                        "schema": {
                            "type": "string"
                        }
                    },
                    {
                        "name": "limit",
                        "in": "query",
                        "schema": {
                            "type": "integer",
                            "default": 10,
                            "minimum": 0,
                            "maximum": 100
                        }
                    },
                    {
                        "name": "skip",
                        "in": "query",
                        "schema": {
                            "type": "integer",
                            "default": 0,
                            "minimum": 0
                        }
                    },
                    {
                        "name": "reverse",
                        "in": "query",
                        "schema": {
                            "type": "boolean"
                        }
                    }
                ],
                "responses": {
                    "200": {
                        "description": "",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "epochNumber": {
                                            "type": "integer"
                                        },
                                        "timestamp": {
                                            "type": "integer"
                                        },
                                        "totalSupply": {
                                            "type": "string"
                                        },
                                        "balanceCount": {
                                            "type": "string"
                                        },
                                        "proportion": {
                                            "type": "number"
                                        },
                                        "total": {
                                            "type": "integer"
                                        },
                                        "list": {
                                            "type": "array",
                                            "items": {
                                                "type": "object",
                                                "properties": {
                                                    "address": {
                                                        "type": "string"
                                                    },
                                                    "account": {
                                                        "type": "object",
                                                        "properties": {
                                                            "address": {
                                                                "type": "string"
                                                            },
                                                            "name": {
                                                                "type": "string"
                                                            }
                                                        }
                                                    },
                                                    "balance": {
                                                        "type": "string"
                                                    },
                                                    "proportion": {
                                                        "type": "number"
                                                    },
                                                    "epochNumber": {
                                                        "type": "integer"
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "600": {
                        "description": "",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "code": {
                                            "type": "integer"
                                        },
                                        "message": {
                                            "type": "string"
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                "tags": [
                    "tokens"
                ]
            }
        },
        '/stat/tokens/list': {
            'get': {
                description: 'list tokens with holder count.',
                tags: ['tokens'],
                "parameters": [
                    {
                        "name": "transferType",
                        "in": "query",
                        "schema": {
                            "type": "string"
                        }
                    },
                    {
                        "name": "addressArray",
                        "in": "query",
                        "description": "use alone",
                        "schema": {
                            "type": "array",
                            "items": {
                                "type": "string"
                            }
                        }
                    },
                    {
                        "name": "accountAddress",
                        "in": "query",
                        "description": "use alone",
                        "schema": {
                            "type": "string"
                        }
                    },
                    {
                        "name": "name",
                        "in": "query",
                        "description": "regex",
                        "schema": {
                            "type": "string"
                        }
                    },
                    {
                        "name": "orderBy",
                        "in": "query",
                        "schema": {
                            "type": "string",
                            "default": "transferCount"
                        }
                    },
                    {
                        "name": "reverse",
                        "in": "query",
                        "schema": {
                            "type": "boolean",
                            "default": true
                        }
                    },
                    {
                        "name": "skip",
                        "in": "query",
                        "schema": {
                            "type": "integer",
                            "default": 0,
                            "minimum": 0
                        }
                    },
                    {
                        "name": "limit",
                        "in": "query",
                        "schema": {
                            "type": "integer",
                            "default": 10,
                            "minimum": 0,
                            "maximum": 100
                        }
                    },
                    {
                        "name": "fields",
                        "in": "query",
                        "schema": {
                            "type": "array",
                            "default": [
                                "price"
                            ],
                            "items": {
                                "type": "string",
                                "enum": [
                                    "icon",
                                    "price"
                                ]
                            }
                        }
                    }
                ],
                "responses": {
                    "200": {
                        "description": "",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "total": {
                                            "type": "integer"
                                        },
                                        "listLimit": {
                                            "type": "integer",
                                            "description": "if exist, require skip+limit <= listLimit"
                                        },
                                        "list": {
                                            "type": "array",
                                            "items": {
                                                "type": "object",
                                                "properties": {
                                                    "address": {
                                                        "type": "string"
                                                    },
                                                    "name": {
                                                        "type": "string"
                                                    },
                                                    "symbol": {
                                                        "type": "string"
                                                    },
                                                    "decimals": {
                                                        "type": "integer"
                                                    },
                                                    "granularity": {
                                                        "type": "integer"
                                                    },
                                                    "totalSupply": {
                                                        "type": "string"
                                                    },
                                                    "holderCount": {
                                                        "type": "integer"
                                                    },
                                                    "transferCount": {
                                                        "type": "integer"
                                                    },
                                                    "transferType": {
                                                        "type": "string"
                                                    },
                                                    "icon": {
                                                        "type": "string"
                                                    },
                                                    "accountAddress": {
                                                        "type": "string",
                                                        "description": "show with accountAddress"
                                                    },
                                                    "balance": {
                                                        "type": "string",
                                                        "description": "show with accountAddress"
                                                    },
                                                    "marketCapId": {
                                                        "type": "number"
                                                    },
                                                    "quoteUrl": {
                                                        "type": "string"
                                                    },
                                                    "moonDexSymbol": {
                                                        "type": "string"
                                                    },
                                                    "price": {
                                                        "type": "number",
                                                        "nullable": true
                                                    },
                                                    "totalPrice": {
                                                        "type": "number"
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "600": {
                        "description": "",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "code": {
                                            "type": "integer"
                                        },
                                        "message": {
                                            "type": "string"
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
            }
        },
        '/stat/top-gas-used': {
            'get': {
                description: 'Top account by gas used.',
                tags: ['Top N'],
                parameters: [
                    {name: 'span', in: 'query', required: true, schema: {type: String, enum: ['24h', '3d', '7d'], default:'24h'},},
                ],
                responses: {
                    200: {}
                }
            }
        },
        '/stat/tx/top-by-type': {
            'get': {
                description: 'cfx and tx send/receive top N',
                tags: ['Top N'],
                parameters: [
                    {name: 'span', in: 'query', required: true, schema: {type: String, enum: ['24','3', '7']}, },
                    {name: 'type', in: 'query', required: true, schema: {type: String, enum: ['h','d']}},
                    {name: 'action', in: 'query', required: true, schema: {type: String,
                            enum: ['cfxSend', 'cfxReceived', 'txnSend', 'txnReceived']}},
                    {name: 'rows', in: 'query', required: false, schema: {type: "integer"}},
                ],
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                "schema": {
                                    type: "object",
                                    properties: {
                                        list: {
                                            "type": "array",
                                            "items": {
                                                type: "object", properties: {
                                                    hex: {type: "string"},
                                                    valueN: {type: "string"},
                                                    rank: {type: "integer", example: 1},
                                                    base32address: {type: "string"},
                                                }
                                            },
                                        },
                                        code: {
                                            type: Number,
                                        },
                                        count: {
                                            type: Number, description: 'total record in this rank'
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/stat/miner/top-by-type': {
            'get': {
                description: 'miner top N',
                tags: ['Top N'],
                parameters: [
                    {name: 'span', in: 'query', required: true, schema: {type: String, enum: ['24','3', '7']}, },
                    {name: 'type', in: 'query', required: true, schema: {type: String, enum: ['h','d']}},
                    {name: 'rows', in: 'query', required: false, schema: {type: "integer"}},
                ],
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                "schema": {
                                    type: "object",
                                    properties: {
                                        list: {
                                            "type": "array",
                                            "items": {
                                                type: "object", properties: {
                                                    hex: {type: "string"},
                                                    valueN: {type: "string"},
                                                    rank: {type: "integer", example: 1},
                                                    base32address: {type: "string"},
                                                }
                                            },
                                        },
                                        code: {
                                            type: Number,
                                        },
                                        count: {
                                            type: Number, description: 'total record in this rank'
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/stat/top-cfx-holder': {
            'get': {
                tags: ['Top N'],
                parameters: [
                    {name: 'type', in: 'query', required: true,
                        schema: {type: String,
                            enum: [TOP_CFX_HOLD, 'rank_address_by_staking','rank_address_by_cfx',
                                'rank_address_by_total_cfx',
                                'rank_contract_by_number_of_participants_1d',
                                'rank_contract_by_number_of_participants_30d',
                                'rank_contract_by_number_of_participants_7d',
                                'rank_contract_by_number_of_receivers_1d',
                                'rank_contract_by_number_of_receivers_30d',
                                'rank_contract_by_number_of_receivers_7d',
                                'rank_contract_by_number_of_senders_1d',
                                'rank_contract_by_number_of_senders_30d',
                                'rank_contract_by_number_of_senders_7d',
                                'rank_contract_by_number_of_transfers_1d',
                                'rank_contract_by_number_of_transfers_7d',
                                'rank_contract_by_number_of_transfers_30d',
                                'rank_contract_by_number_of_participants_3d',
                                'rank_contract_by_number_of_receivers_3d',
                                'rank_contract_by_number_of_senders_3d',
                                'rank_contract_by_number_of_transfers_3d',
                            ]}
                            },
                    {name: 'limit', in: 'query', required: false, schema: {type: "integer"}},
                ],
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                "schema": {
                                    type: "object",
                                    properties: {
                                        list: {
                                            "type": "array",
                                            "items": {
                                                type: "object", properties: {
                                                    hex: {type: "string"},
                                                    valueN: {type: "string"},
                                                    rank: {type: "integer", example: 1},
                                                    base32address: {type: "string"},
                                                }
                                            },
                                        },
                                        code: {
                                            type: Number,
                                        },
                                        count: {
                                            type: Number, description: 'total record in this rank'
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        "/stat/server-info": {
            "get": {
                tags: ['developers'],
                parameters: [],
                "responses": {
                    "200": {
                        "content": {
                            "application/json": {
                                schema: {
                                    type: "object", properties: {
                                        code: {type: Number,},
                                        message: {type: String}
                                    }
                                }
                            }
                        }
                    }
                }
            },
        },
        "/inventory": {
            "get": {
                "tags": [
                    "developers"
                ],
                "summary": "searches inventory",
                "description": "By passing in the appropriate options, you can search for\navailable inventory in the system\n",
                "operationId": "searchInventory",
                "parameters": [
                    {
                        "name": "searchString",
                        "in": "query",
                        "description": "pass an optional search string for looking up inventory",
                        "required": false,
                        "style": "form",
                        "explode": true,
                        "schema": {
                            "type": "string"
                        }
                    },
                    {
                        "name": "skip",
                        "in": "query",
                        "description": "number of records to skip for pagination",
                        "required": false,
                        "style": "form",
                        "explode": true,
                        "schema": {
                            "minimum": 0,
                            "type": "integer",
                            "format": "int32"
                        }
                    },
                    {
                        "name": "limit",
                        "in": "query",
                        "description": "maximum number of records to return",
                        "required": false,
                        "style": "form",
                        "explode": true,
                        "schema": {
                            "maximum": 50,
                            "minimum": 0,
                            "type": "integer",
                            "format": "int32"
                        }
                    }
                ],
                "responses": {
                    "200": {
                        "description": "search results matching criteria",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/components/schemas/InventoryItem"
                                    }
                                }
                            }
                        }
                    },
                    "400": {
                        "description": "bad input parameter"
                    }
                }
            },
            "post": {
                "tags": [
                    "admins"
                ],
                "summary": "adds an inventory item",
                "description": "Adds an item to the system",
                "operationId": "addInventory",
                "requestBody": {
                    "description": "Inventory item to add",
                    "content": {
                        "application/json": {
                            "schema": {
                                "$ref": "#/components/schemas/InventoryItem"
                            }
                        }
                    }
                },
                "responses": {
                    "201": {
                        "description": "item created"
                    },
                    "400": {
                        "description": "invalid input, object invalid"
                    },
                    "409": {
                        "description": "an existing item already exists"
                    }
                }
            }
        },
        '/stat/txn/daily/list': {
            'get': {
                description: 'list daily transaction count.',
                tags: ['daily'],
                "parameters": [
                    {
                        "name": "skip",
                        "in": "query",
                        "schema": {
                            "type": "integer",
                            "default": 0,
                            "minimum": 0
                        }
                    },
                    {
                        "name": "limit",
                        "in": "query",
                        "schema": {
                            "type": "integer",
                            "default": 10,
                            "minimum": 0,
                            "maximum": 100
                        }
                    }
                ],
                "responses": {
                    "200": {
                        "description": "",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "count": {
                                            "type": "integer"
                                        },
                                        "rows": {
                                            "type": "array",
                                            "items": {
                                                "type": "object",
                                                "properties": {
                                                    "statDay": {
                                                        "type": "date"
                                                    },
                                                    "txCount": {
                                                        "type": "integer"
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "600": {
                        "description": "",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "code": {
                                            "type": "integer"
                                        },
                                        "message": {
                                            "type": "string"
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
            }
        },
        '/stat/cfx_holder/daily/list': {
            'get': {
                description: 'list daily cfx holder count.',
                tags: ['daily'],
                "parameters": [
                    {
                        "name": "skip",
                        "in": "query",
                        "schema": {
                            "type": "integer",
                            "default": 0,
                            "minimum": 0
                        }
                    },
                    {
                        "name": "limit",
                        "in": "query",
                        "schema": {
                            "type": "integer",
                            "default": 10,
                            "minimum": 0,
                            "maximum": 100
                        }
                    }
                ],
                "responses": {
                    "200": {
                        "description": "",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "count": {
                                            "type": "integer"
                                        },
                                        "rows": {
                                            "type": "array",
                                            "items": {
                                                "type": "object",
                                                "properties": {
                                                    "statDay": {
                                                        "type": "date"
                                                    },
                                                    "holderCount": {
                                                        "type": "integer"
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "600": {
                        "description": "",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "code": {
                                            "type": "integer"
                                        },
                                        "message": {
                                            "type": "string"
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
            }
        },
    },
    "components": {
        "schemas": {
            "InventoryItem": {
                "required": [
                    "id",
                    "manufacturer",
                    "name",
                    "releaseDate"
                ],
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string",
                        "format": "uuid",
                        "example": "d290f1ee-6c54-4b01-90e6-d701748f0851"
                    },
                    "name": {
                        "type": "string",
                        "example": "Widget Adapter"
                    },
                    "releaseDate": {
                        "type": "string",
                        "format": "date-time",
                        "example": "2016-08-29T09:12:33.001Z"
                    },
                    "manufacturer": {
                        "$ref": "#/components/schemas/Manufacturer"
                    }
                }
            },
            "Manufacturer": {
                "required": [
                    "name"
                ],
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "example": "ACME Corporation"
                    },
                    "homePage": {
                        "type": "string",
                        "format": "url",
                        "example": "https://www.acme-corp.com"
                    },
                    "phone": {
                        "type": "string",
                        "example": "408-867-5309"
                    }
                }
            }
        }
    }
}