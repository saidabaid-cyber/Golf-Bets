import type { SocialPerson } from "./social-connections";

const normalized = (value: string) => value.trim().replace(/^@/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
/** Ranking uses identities authorized by the existing directory/card RPC and
 * the public same-club discovery endpoint. It never infers peer coordinates. */
export function rankFriendResults(people: SocialPerson[], query: string, sameClubIds: ReadonlySet<string>, ownerId: string, blockedIds: readonly string[] = []) {
  const term = normalized(query), seen = new Set<string>();
  const score = (person: SocialPerson) => normalized(person.username) === term ? 0 : normalized(person.display_name) === term ? 1 : sameClubIds.has(person.user_id) ? 2 : 3;
  return people.filter(person => {
    if (person.user_id === ownerId || blockedIds.includes(person.user_id) || seen.has(person.user_id)) return false;
    seen.add(person.user_id); return true;
  }).sort((left, right) => score(left) - score(right) || left.display_name.localeCompare(right.display_name, "es") || left.username.localeCompare(right.username));
}
export function filterCurrentFriends(people: SocialPerson[], query: string) {
  const term = normalized(query);
  return people.filter(person => !term || normalized(person.display_name).includes(term) || normalized(person.username).includes(term));
}
