// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

abstract contract Precompiled {

    function ecrecover(bytes32 hash, uint8 v, bytes32 r, bytes32 s) public view virtual returns (address);

    function sha256(bytes memory data) public view virtual returns (bytes32);

    function ripemd160(bytes memory data) public view virtual returns (bytes20);

    function identity(bytes memory data) public view virtual returns (bytes memory);

    function modexp(
        bytes memory base,
        bytes memory exponent,
        bytes memory modulus
    ) public view virtual returns (bytes memory);

    function bn256Add(
        uint256 x1,
        uint256 y1,
        uint256 x2,
        uint256 y2
    ) public view virtual returns (uint256 x3, uint256 y3);

    function bn256ScalarMul(
        uint256 x,
        uint256 y,
        uint256 scalar
    ) public view virtual returns (uint256 x2, uint256 y2);

    function bn256Pairing(bytes memory input) public view virtual returns (bool);

    function blake2f(bytes memory input) public view virtual returns (bytes memory);

    function BLS12_G1ADD(
        uint256 x1,
        uint256 y1,
        uint256 x2,
        uint256 y2
    ) public view virtual returns (uint256 x3, uint256 y3);

    function BLS12_G1MSM(bytes memory input) public view virtual returns (uint256 x, uint256 y);

    function BLS12_G2ADD(
        uint256[2] memory x1,
        uint256[2] memory y1,
        uint256[2] memory x2,
        uint256[2] memory y2
    ) public view virtual returns (uint256[2] memory x3, uint256[2] memory y3);

    function BLS12_G2MSM(bytes memory input)
    public view virtual
    returns (uint256[2] memory x, uint256[2] memory y);

    function BLS12_PAIRING_CHECK(bytes memory input) public view virtual returns (bool);

    function BLS12_MAP_FP_TO_G1(uint256 fp)
    public view virtual
    returns (uint256 x, uint256 y);

    function BLS12_MAP_FP2_TO_G2(uint256[2] memory fp2)
    public view virtual
    returns (uint256[2] memory x, uint256[2] memory y);

    function BLS12_G1MUL(
        uint256 x,
        uint256 y,
        uint256 scalar
    ) public view virtual returns (uint256 xr, uint256 yr);

    function BLS12_G2MUL(
        uint256[2] memory x,
        uint256[2] memory y,
        uint256 scalar
    ) public view virtual returns (uint256[2] memory xr, uint256[2] memory yr);
}
