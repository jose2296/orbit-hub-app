/**
 * The board of a list.
 *
 * The route exists before the screen does, because `routeForList` sends boards
 * here and a route that nothing renders is an error at the moment somebody opens
 * a board. The body arrives with the screen; what is here is the shape the file
 * has to have for the project to compile in the meantime.
 */
export default function BoardScreen() {
  return null;
}
