import {
  loadActiveCommunityId,
  loadCommunities,
} from "@/features/communities/communityStorage";
import { invokeTauri } from "@/shared/api/tauri";
import type {
  Profile,
  UpdateProfileInput,
  UserProfileSummary,
  UserSearchPage,
  UserSearchResult,
  UsersBatchResponse,
} from "@/shared/api/types";

type RawProfile = {
  pubkey: string;
  display_name: string | null;
  avatar_url: string | null;
  about: string | null;
  nip05_handle: string | null;
  owner_pubkey: string | null;
  has_profile_event?: boolean;
};

type RawUserProfileSummary = Omit<RawProfile, "pubkey" | "about"> & {
  name?: string | null;
  is_agent?: boolean;
};

type RawUsersBatchResponse = {
  profiles: Record<string, RawUserProfileSummary>;
  missing: string[];
};

type RawUserSearchResult = RawUserProfileSummary & { pubkey: string };

type RawSearchUsersResponse = {
  users: RawUserSearchResult[];
  next_cursor?: string | null;
};

function fromRawProfile(profile: RawProfile): Profile {
  return {
    pubkey: profile.pubkey,
    displayName: profile.display_name,
    avatarUrl: profile.avatar_url,
    about: profile.about,
    nip05Handle: profile.nip05_handle,
    ownerPubkey: profile.owner_pubkey,
    hasProfileEvent: profile.has_profile_event ?? false,
  };
}

function fromRawUserProfileSummary(
  profile: RawUserProfileSummary,
): UserProfileSummary {
  return {
    displayName: profile.display_name,
    name: profile.name ?? null,
    avatarUrl: profile.avatar_url,
    nip05Handle: profile.nip05_handle,
    ownerPubkey: profile.owner_pubkey,
    isAgent: profile.is_agent ?? false,
  };
}

function fromRawUserSearchResult(user: RawUserSearchResult): UserSearchResult {
  return {
    pubkey: user.pubkey,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    nip05Handle: user.nip05_handle,
    ownerPubkey: user.owner_pubkey,
    isAgent: user.is_agent ?? false,
  };
}

export async function getProfile(): Promise<Profile> {
  const profile = await invokeTauri<RawProfile>("get_profile");
  return fromRawProfile(profile);
}

export async function updateProfile(
  input: UpdateProfileInput,
): Promise<Profile> {
  const profile = await invokeTauri<RawProfile>("update_profile", input);
  const active = loadCommunities().find(
    (community) => community.id === loadActiveCommunityId(),
  );
  if (active) rememberProfileHome(active.relayUrl);
  void syncProfileEverywhere();
  return fromRawProfile(profile);
}

const PROFILE_HOME_KEY = "anything.profile-home";

/** The server where you last edited your profile: the one to copy from. */
function rememberProfileHome(relayUrl: string) {
  try {
    localStorage.setItem(PROFILE_HOME_KEY, relayUrl);
  } catch {
    // Without storage the first server stays the source.
  }
}

/**
 * Your profile lives on each server's relay; this copies it from where you
 * last edited it (your first server until then) to every server you're in
 * whose profile differs or is missing (see `sync_profile_to_relays`).
 * Resolves to how many were updated; never throws.
 */
export async function syncProfileEverywhere(): Promise<number> {
  const communities = loadCommunities();
  if (communities.length < 2) return 0;
  const relayUrls = communities.map((community) => community.relayUrl);
  let home: string | null = null;
  try {
    home = localStorage.getItem(PROFILE_HOME_KEY);
  } catch {
    home = null;
  }
  const sourceRelayUrl = home && relayUrls.includes(home) ? home : relayUrls[0];
  try {
    return await invokeTauri<number>("sync_profile_to_relays", {
      sourceRelayUrl,
      relayUrls,
    });
  } catch {
    return 0;
  }
}

export async function updateProfileAtRelay(input: {
  relayUrl: string;
  expectedPubkey: string;
  expectedAvatarUrl: string | null;
  avatarUrl: string;
}): Promise<Profile> {
  const profile = await invokeTauri<RawProfile>(
    "update_profile_at_relay",
    input,
  );
  rememberProfileHome(input.relayUrl);
  void syncProfileEverywhere();
  return fromRawProfile(profile);
}

export async function getUserProfile(pubkey?: string): Promise<Profile> {
  const profile = await invokeTauri<RawProfile>("get_user_profile", { pubkey });
  return fromRawProfile(profile);
}

export async function getUsersBatch(
  pubkeys: string[],
): Promise<UsersBatchResponse> {
  const response = await invokeTauri<RawUsersBatchResponse>("get_users_batch", {
    pubkeys,
  });

  return {
    profiles: Object.fromEntries(
      Object.entries(response.profiles).map(([pubkey, profile]) => [
        pubkey,
        fromRawUserProfileSummary(profile),
      ]),
    ),
    missing: response.missing,
  };
}

export async function searchUsers(
  query: string,
  limit = 8,
  cursor?: string | null,
): Promise<UserSearchPage> {
  const response = await invokeTauri<RawSearchUsersResponse>("search_users", {
    query,
    limit,
    cursor: cursor ?? null,
  });
  return {
    users: response.users.map(fromRawUserSearchResult),
    nextCursor: response.next_cursor ?? null,
  };
}
