defmodule OpenBoard.Repo do
  use Ecto.Repo,
    otp_app: :open_board,
    adapter: Ecto.Adapters.SQLite3
end
