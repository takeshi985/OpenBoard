defmodule OpenBoardWeb.PageController do
  use OpenBoardWeb, :controller

  def home(conn, _params) do
    render(conn, :home)
  end
end
