// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DoodleChampionTracker
/// @notice On-chain signup + match counter for Doodle Champion on Celo.
///         Deliberately tiny: MiniPay only sends legacy (type-0) transactions
///         and pays network fees in stablecoins, so every write path is a
///         single SSTORE-light call with minimal calldata.
/// @dev    No owner, no upgradeability, no funds held. Anyone can record their
///         own runs; there is nothing to steal and nothing to pause.
///         Pattern mirrored from MiniRushTracker — this is a separate game.
contract DoodleChampionTracker {
    struct Player {
        bool registered;    // has signed up at least once
        uint32 matches;     // matches this player has recorded
        uint32 bestScore;   // best score this player has recorded
        uint64 lastPlayed;  // block.timestamp of the most recent match
    }

    /// @notice Per-player stats, keyed by wallet address.
    mapping(address => Player) public players;

    /// @notice Distinct wallets that have ever signed up.
    uint256 public totalPlayers;

    /// @notice Total matches recorded across all players.
    uint256 public totalMatches;

    event SignedUp(address indexed player, uint256 totalPlayers);

    event MatchPlayed(
        address indexed player,
        uint32 score,
        uint16 place,
        uint16 modeId,
        uint32 playerMatches
    );

    /// @notice Register the caller. Idempotent — safe to call on every connect.
    function signUp() public returns (bool) {
        return _register(msg.sender);
    }

    /// @notice Record one finished match for the caller. Auto-signs-up on the
    ///         first match so the game can skip a separate signup transaction.
    /// @param score  Final score for the run (mode-specific).
    /// @param place  1 = win/clear, 2 = loss/fail, 0 = scored run.
    /// @param modeId Game mode index (see frontend MODE_CHAIN_ID).
    function recordMatch(uint32 score, uint16 place, uint16 modeId) external {
        _register(msg.sender);

        Player storage p = players[msg.sender];
        unchecked {
            p.matches += 1;
            totalMatches += 1;
        }
        if (score > p.bestScore) p.bestScore = score;
        p.lastPlayed = uint64(block.timestamp);

        emit MatchPlayed(msg.sender, score, place, modeId, p.matches);
    }

    function hasSignedUp(address player) external view returns (bool) {
        return players[player].registered;
    }

    function statsOf(address player)
        external
        view
        returns (bool registered, uint32 matches, uint32 bestScore, uint64 lastPlayed)
    {
        Player storage p = players[player];
        return (p.registered, p.matches, p.bestScore, p.lastPlayed);
    }

    function _register(address player) internal returns (bool) {
        Player storage p = players[player];
        if (p.registered) return false;
        p.registered = true;
        unchecked {
            totalPlayers += 1;
        }
        emit SignedUp(player, totalPlayers);
        return true;
    }
}
